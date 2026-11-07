/**
 * End-to-end flow test with Jira and Forge storage replaced by in-memory fakes.
 * Run with: node --test --experimental-test-module-mocks "test/**\/*.test.js"
 */
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';

const store = new Map();
const comments = [];
const properties = new Map();
let admins = new Set(['admin-1']);
let currentUser = 'dev-1';
const issues = {
  'PRIV-1': {
    id: '10001', key: 'PRIV-1', summary: 'Add SA ID number field to customer signup', projectKey: 'PRIV',
    reporterAccountId: 'dev-1', labels: [], text: 'Add SA ID number field to customer signup\nStore it on the record.',
  },
  'PRIV-5': {
    id: '10005', key: 'PRIV-5', summary: 'Update footer copyright year', projectKey: 'PRIV',
    reporterAccountId: 'dev-1', labels: [], text: 'Update footer copyright year',
  },
};
const byIdOrKey = (k) => issues[k] || Object.values(issues).find((i) => i.id === String(k));

mock.module('@forge/kvs', {
  namedExports: {
    kvs: {
      get: async (k) => (store.has(k) ? structuredClone(store.get(k)) : undefined),
      set: async (k, v) => void store.set(k, structuredClone(v)),
    },
  },
});

mock.module('../src/jira.js', {
  namedExports: {
    getWorkItem: async (k) => structuredClone(byIdOrKey(k)),
    currentUserIsJiraAdmin: async () => admins.has(currentUser),
    setPreflightProperty: async (id, v) => void properties.set(id, v),
    getPreflightProperty: async (id) => properties.get(id) || null,
    addComment: async (key, body) => void comments.push({ key, body }),
  },
});

const backend = await import('../src/backend.js');
const service = await import('../src/service.js');
const { saveRules, getRules } = await import('../src/store.js');

test('install loads drafts, nothing is enforced', async () => {
  await backend.onInstalled();
  assert.ok((await getRules()).every((r) => r.status === 'draft'));
  assert.deepEqual(await backend.validateTransition({ issue: { id: '10001' } }), { result: true });
});

test('full gate flow: blocked → answers → approval → clear', async () => {
  const rules = (await getRules()).map((r) => ({ ...r, status: 'active', updatedAt: 1 }));
  await saveRules(rules);

  const blocked = await backend.validateTransition({ issue: { id: '10001' } });
  assert.equal(blocked.result, false);
  assert.match(blocked.errorMessage, /Identifying numbers \(POPIA s1, s10, s11, s13, s14, s18\)/);

  // Control ticket is unaffected.
  assert.equal((await backend.validateTransition({ issue: { id: '10005' } })).result, true);

  // A developer cannot approve.
  currentUser = 'dev-1';
  await assert.rejects(service.approve('PRIV-1', 'popia-identifiers', 'dev-1'), /approver/);

  // Rovo saves answers on the developer's behalf.
  for (const [requirementId, answer] of [
    ['purpose', 'Verify callers against FICA records'],
    ['minimality', 'Date of birth alone is shared by many customers'],
    ['lawful-basis', 'Required to comply with an obligation imposed by law'],
    ['notification', 'Signup screen links to the privacy notice section on ID numbers'],
    ['retention', 'Deleted 5 years after account closure'],
  ]) {
    const out = await backend.actionSaveAnswer({ issueKey: 'PRIV-1', ruleId: 'popia-identifiers', requirementId, answer }, { principal: { accountId: 'dev-1' } });
    assert.equal(out.ok, true);
  }

  // Rovo cannot "answer" the approval requirement.
  const sneaky = await backend.actionSaveAnswer({ issueKey: 'PRIV-1', ruleId: 'popia-identifiers', requirementId: 'io-approval', answer: 'approved' });
  assert.equal(sneaky.ok, false);

  // Request approval posts a comment.
  const requested = await backend.actionRequestApproval({ issueKey: 'PRIV-1' }, { principal: { accountId: 'dev-1' } });
  assert.equal(requested.posted, true);
  assert.equal(comments.length, 1);

  // Admin approves; gate opens.
  currentUser = 'admin-1';
  await service.approve('PRIV-1', 'popia-identifiers', 'admin-1', 'Matches policy 4.1');
  assert.deepEqual(await backend.validateTransition({ issue: { id: '10001' } }), { result: true });
  assert.equal(properties.get('10001').status, 'clear');

  // Editing an answer re-blocks.
  currentUser = 'dev-1';
  await service.saveAnswers('PRIV-1', 'popia-identifiers', { retention: 'Kept indefinitely for analytics' }, 'dev-1');
  assert.equal((await backend.validateTransition({ issue: { id: '10001' } })).result, false);

  // The audit trail recorded everything, newest first.
  const record = store.get('rec:10001');
  assert.ok(record.audit.length >= 6);
  assert.match(record.audit.at(-1).event, /Matched "Identifying numbers"/);
  assert.ok(record.audit.some((e) => /Answered purpose/.test(e.event)));
});

test('separation of duties blocks the reporter even if they are an admin', async () => {
  store.set('settings', { approverAccountIds: [], failClosed: false, separationOfDuties: true });
  admins = new Set(['dev-1']);
  currentUser = 'dev-1';
  await assert.rejects(service.approve('PRIV-1', 'popia-identifiers', 'dev-1'), /Separation of duties/);
  store.set('settings', { approverAccountIds: [], failClosed: false });
});

test('agent check output never claims compliance', async () => {
  const out = await backend.actionCheckIssue({ context: { jira: { issueKey: 'PRIV-5' } } });
  assert.equal(out.preflightStatus, 'not-applicable');
  assert.match(out.statusMeaning, /not a statement that the work is compliant/);
});

test('validator fails closed by default and open when configured', async () => {
  store.delete('settings');
  const brokenId = 'does-not-exist';
  const held = await backend.validateTransition({ issue: { id: brokenId } });
  assert.equal(held.result, false);
  assert.match(held.errorMessage, /fail-closed/);
  store.set('settings', { approverAccountIds: [], failClosed: false });
  assert.equal((await backend.validateTransition({ issue: { id: brokenId } })).result, true);
  store.set('settings', { approverAccountIds: [], failClosed: true });
});

test('rewording the ticket does not open the gate (sticky matches)', async () => {
  issues['PRIV-7'] = {
    id: '10007', key: 'PRIV-7', summary: 'Capture passport number at checkout', projectKey: 'PRIV',
    reporterAccountId: 'dev-1', labels: [], text: 'Capture passport number at checkout',
  };
  assert.equal((await backend.validateTransition({ issue: { id: '10007' } })).result, false);
  issues['PRIV-7'].text = 'Capture a document reference at checkout';
  const still = await backend.validateTransition({ issue: { id: '10007' } });
  assert.equal(still.result, false);
  const { result } = await service.assess('PRIV-7');
  assert.equal(result.applicable[0].why.sticky, true);

  // Only an approver dismissing it (with a reason) removes it.
  currentUser = 'admin-1';
  admins = new Set(['admin-1']);
  await service.dismissRule('PRIV-7', 'popia-identifiers', 'admin-1', 'Reference is not an identity document');
  assert.equal((await backend.validateTransition({ issue: { id: '10007' } })).result, true);
});

test('validator records a heartbeat so the UI can tell the gate is attached', async () => {
  const gates = store.get('gates');
  assert.ok(gates.PRIV.lastRunAt > 0);
});

test('named approvers replace the Jira-admin fallback', async () => {
  store.set('settings', { approverAccountIds: ['io-1'], failClosed: true });
  admins = new Set(['admin-1']);
  currentUser = 'admin-1';
  assert.equal(await service.canCurrentUserApprove('admin-1'), false);
  currentUser = 'io-1';
  assert.equal(await service.canCurrentUserApprove('io-1'), true);
  store.set('settings', { approverAccountIds: [], failClosed: true });
  currentUser = 'admin-1';
  assert.equal(await service.canCurrentUserApprove('admin-1'), true);
  assert.equal(await service.approverMode(), 'small-team');
});

test('approval requests are rate limited per work item', async () => {
  issues['PRIV-8'] = {
    id: '10008', key: 'PRIV-8', summary: 'Bulk SMS campaign to all customers', projectKey: 'PRIV',
    reporterAccountId: 'dev-1', labels: [], text: 'Bulk SMS campaign to all customers',
  };
  const first = await backend.actionRequestApproval({ issueKey: 'PRIV-8' });
  const second = await backend.actionRequestApproval({ issueKey: 'PRIV-8' });
  assert.equal(first.posted, true);
  assert.equal(second.posted, false);
  assert.match(second.reason, /already requested/);
});

test('exceptions expire', async () => {
  currentUser = 'admin-1';
  await service.setException('PRIV-8', 'admin-1', 'Regulator-approved pilot', 1);
  assert.equal((await service.assess('PRIV-8')).result.status, 'exception');
  const rec = store.get('rec:10008');
  rec.exception.expiresAt = Date.now() - 1000;
  store.set('rec:10008', rec);
  const { result } = await service.assess('PRIV-8');
  assert.equal(result.status, 'blocked');
  assert.match(result.summary, /expired/);
});

test('Rovo can only save DRAFT rules, and only for admins', async () => {
  const draft = {
    title: 'Location tracking',
    clause: 'Privacy Policy 10.2',
    summary: 'Collecting precise location needs a purpose and retention period.',
    keywords: 'gps location, location tracking, geolocation',
    requirements: JSON.stringify([
      { id: 'purpose', label: 'Purpose of collecting location', type: 'answer' },
      { id: 'io-approval', label: 'Approval', type: 'approval' },
    ]),
  };
  currentUser = 'dev-1';
  admins = new Set(['admin-1']);
  assert.equal((await backend.actionDraftRule(draft)).ok, false);

  currentUser = 'admin-1';
  const saved = await backend.actionDraftRule(draft, { principal: { accountId: 'admin-1' } });
  assert.equal(saved.ok, true);
  assert.equal(saved.status, 'draft');
  const rule = (await getRules()).find((r) => r.id === saved.ruleId);
  assert.equal(rule.status, 'draft');

  issues['PRIV-9'] = { id: '10009', key: 'PRIV-9', summary: 'Add GPS location tracking', projectKey: 'PRIV', labels: [], text: 'Add GPS location tracking' };
  const check = await backend.actionCheckIssue({ issueKey: 'PRIV-9' });
  assert.ok(!check.rules.some((r) => r.ruleId === saved.ruleId), 'drafts must not be enforced');

  const bad = await backend.actionDraftRule({ ...draft, requirements: 'not json' });
  assert.equal(bad.ok, false);
});
