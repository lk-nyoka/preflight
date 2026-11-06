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
  assert.match(blocked.errorMessage, /Identifying numbers \(POPIA s1, s10, s13, s14\)/);

  // Control ticket is unaffected.
  assert.equal((await backend.validateTransition({ issue: { id: '10005' } })).result, true);

  // A developer cannot approve.
  currentUser = 'dev-1';
  await assert.rejects(service.approve('PRIV-1', 'popia-identifiers', 'dev-1'), /approver/);

  // Rovo saves answers on the developer's behalf.
  for (const [requirementId, answer] of [
    ['purpose', 'Verify callers against FICA records'],
    ['minimality', 'Date of birth alone is shared by many customers'],
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
  assert.match(record.audit.at(-1).event, /Answered purpose/);
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

test('validator fails open by default and closed when configured', async () => {
  const brokenId = 'does-not-exist';
  assert.equal((await backend.validateTransition({ issue: { id: brokenId } })).result, true);
  store.set('settings', { approverAccountIds: [], failClosed: true });
  assert.equal((await backend.validateTransition({ issue: { id: brokenId } })).result, false);
});
