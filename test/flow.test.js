/**
 * End-to-end flows with Jira and Forge storage replaced by in-memory fakes.
 * The KVS fake implements FAIL_IF_EXISTS and prefix queries, so write-once
 * audit and locking are exercised for real.
 */
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';

const store = new Map();
const comments = [];
const properties = new Map();
const created = [];
let admins = new Set(['admin-1']);
let currentUser = 'dev-1';
let coverageRows = [];
const issues = {};
const addIssue = (n, summary, extra = {}) => {
  issues[`PRIV-${n}`] = { id: String(10000 + n), key: `PRIV-${n}`, summary, projectKey: 'PRIV', reporterAccountId: 'dev-1', labels: [], text: summary, ...extra };
};
addIssue(1, 'Add SA ID number field to customer signup');
addIssue(5, 'Update footer copyright year');
const byIdOrKey = (k) => issues[k] || Object.values(issues).find((i) => i.id === String(k));

mock.module('@forge/kvs', {
  namedExports: {
    WhereConditions: { beginsWith: (v) => ({ beginsWith: v }) },
    kvs: {
      get: async (k) => (store.has(k) ? structuredClone(store.get(k)) : undefined),
      set: async (k, v, opts) => {
        if (opts?.keyPolicy === 'FAIL_IF_EXISTS' && store.has(k)) {
          const e = new Error('KEY_ALREADY_EXISTS');
          e.code = 'KEY_ALREADY_EXISTS';
          throw e;
        }
        store.set(k, structuredClone(v));
      },
      delete: async (k) => void store.delete(k),
      query: () => {
        let prefix = '';
        const q = {
          where: (_f, c) => { prefix = c.beginsWith; return q; },
          limit: () => q,
          cursor: () => q,
          getMany: async () => ({ results: [...store.entries()].filter(([k]) => k.startsWith(prefix)).map(([key, value]) => ({ key, value: structuredClone(value) })) }),
        };
        return q;
      },
    },
  },
});

mock.module('../src/jira.js', {
  namedExports: {
    getWorkItem: async (k) => {
      const i = byIdOrKey(k);
      if (!i) throw new Error(`Reading ${k} failed (404)`);
      return structuredClone(i);
    },
    currentUserIsJiraAdmin: async () => admins.has(currentUser),
    setPreflightProperty: async (id, v) => void properties.set(id, v),
    getPreflightProperty: async (id) => properties.get(id) || null,
    addComment: async (key, body) => void comments.push({ key, body }),
    getCreatableIssueTypes: async () => [{ id: '1', name: 'Task' }],
    createIssue: async (projectKey, typeId, summary) => {
      const n = 100 + created.length;
      addIssue(n, summary);
      created.push(`PRIV-${n}`);
      return { key: `PRIV-${n}` };
    },
    getWorkflowCoverage: async () => coverageRows,
    adfToText: (n) => (typeof n === 'string' ? n : JSON.stringify(n || '')),
    getDisplayName: async (id) => ({ 'io-1': 'Thandi M.' }[id] || null),
  },
});

mock.module('@forge/resolver', {
  defaultExport: class {
    constructor() { this.defs = {}; }
    define(name, fn) { this.defs[name] = fn; }
    getDefinitions() { return this.defs; }
  },
});

const backend = await import('../src/backend.js');
const service = await import('../src/service.js');
const governance = await import('../src/governance.js');
const store_ = await import('../src/store.js');
const { adminHandler } = await import('../src/resolvers/admin.js');
const { panelHandler } = await import('../src/resolvers/panel.js');

const as = (user) => { currentUser = user; };
const panel = (name, issueKey, payload = {}) =>
  panelHandler[name]({ payload, context: { accountId: currentUser, extension: { issue: { id: byIdOrKey(issueKey).id } } } });
const admin = (name, payload = {}) => adminHandler[name]({ payload, context: { accountId: currentUser } });
const goodAnswers = {
  purpose: 'Verify callers against FICA records before account changes',
  minimality: 'Date of birth is shared by many customers, so it cannot verify identity',
  'lawful-basis': 'Required to comply with an obligation imposed by law',
  retention: 'Deleted five years after the account is closed, as FICA requires',
};

test('install loads drafts and nothing is enforced', async () => {
  await backend.onInstalled();
  assert.ok((await store_.getRules()).every((r) => r.status === 'draft'));
  assert.deepEqual(await backend.validateDone({ issue: { id: '10001' } }), { result: true });
  assert.match((await store_.listAudit('admin'))[0].event, /drafts/);
});

test('admin activates the pack via Load demo (small-team mode)', async () => {
  as('admin-1');
  const out = await admin('loadDemo', { projectKey: 'PRIV' });
  assert.equal(out.ok, true, out.error);
  assert.equal(created.length, 5);
  assert.ok((await store_.getRules()).every((r) => r.status === 'active'));
  assert.ok(out.rules.every((r) => r.warnings.length === 0));
});

test('build gate holds work until answers and approval; done gate also needs evidence', async () => {
  const build = await backend.validateBuild({ issue: { id: '10001' } });
  assert.equal(build.result, false);
  assert.match(build.errorMessage, /before work starts/);
  assert.equal((await backend.validateBuild({ issue: { id: '10005' } })).result, true);

  as('dev-1');
  await assert.rejects(service.approve('PRIV-1', 'popia-identifiers', 'dev-1'), /Jira admin/);
  const saved = await panel('saveAnswers', 'PRIV-1', { ruleId: 'popia-identifiers', answers: goodAnswers });
  assert.equal(saved.ok, true, saved.error);
  assert.equal(saved.result.awaitingApproval, true);
  assert.equal(store.get('queue:10001').awaitingApproval, true, 'inbox shows it is waiting for approval');

  as('admin-1');
  const approved = await panel('approve', 'PRIV-1', { ruleId: 'popia-identifiers' });
  assert.equal(approved.ok, true, approved.error);
  assert.equal((await backend.validateBuild({ issue: { id: '10001' } })).result, true);
  const done = await backend.validateDone({ issue: { id: '10001' } });
  assert.equal(done.result, false);
  assert.match(done.errorMessage, /Privacy notice/);

  as('dev-1');
  await panel('saveAnswers', 'PRIV-1', { ruleId: 'popia-identifiers', answers: { notification: 'https://wiki.example.com/notice' } });
  assert.equal((await backend.validateDone({ issue: { id: '10001' } })).result, true);
  assert.equal(store.has('queue:10001'), false, 'inbox entry removed once clear');
  assert.equal(properties.get('10001').status, 'clear');
});

test('audit is write-once: events cannot be overwritten and are newest-first', async () => {
  const events = await store_.listAudit('10001');
  assert.ok(events.length >= 4);
  assert.ok(events[0].at >= events.at(-1).at);
  const key = [...store.keys()].find((k) => k.startsWith('audit:10001:'));
  await assert.rejects(() => (async () => {
    const { kvs } = await import('@forge/kvs');
    await kvs.set(key, { forged: true }, { keyPolicy: 'FAIL_IF_EXISTS' });
  })());
});

test('Rovo can only propose; a draft never satisfies a requirement', async () => {
  addIssue(2, 'Store patients medical records');
  as('dev-1');
  const proposed = await backend.actionProposeAnswer(
    { issueKey: 'PRIV-2', ruleId: 'popia-special', requirementId: 'basis', answer: 'Consent of the data subject' },
    { principal: { accountId: 'dev-1' } },
  );
  assert.equal(proposed.ok, true, proposed.error);
  const { result, record } = await service.assess('PRIV-2');
  assert.equal(record.drafts['popia-special'].basis.value, 'Consent of the data subject');
  assert.equal(result.applicable[0].requirements.find((r) => r.id === 'basis').satisfied, false);

  const approval = await backend.actionProposeAnswer({ issueKey: 'PRIV-2', ruleId: 'popia-special', requirementId: 'io-approval', answer: 'approved' });
  assert.equal(approval.ok, false);
  const badChoice = await backend.actionProposeAnswer({ issueKey: 'PRIV-2', ruleId: 'popia-special', requirementId: 'basis', answer: 'Because the ticket says so' });
  assert.equal(badChoice.ok, false);
  const events = await store_.listAudit('10002');
  assert.ok(events.some((e) => e.via === 'agent' && /proposed/.test(e.event)));
});

test('rewording does not open the gate; only an approver dismissal does', async () => {
  addIssue(7, 'Capture passport number at checkout');
  await backend.onIssueChanged({ issue: { id: '10007' } }); // create trigger records the match
  assert.equal((await backend.validateBuild({ issue: { id: '10007' } })).result, false);
  issues['PRIV-7'].text = 'Capture a document reference at checkout';
  assert.equal((await backend.validateBuild({ issue: { id: '10007' } })).result, false);
  as('admin-1');
  await assert.rejects(service.dismissRule('PRIV-7', 'popia-identifiers', 'admin-1', 'short'), /at least 10/);
  await service.dismissRule('PRIV-7', 'popia-identifiers', 'admin-1', 'Reference is not an identity document');
  assert.equal((await backend.validateBuild({ issue: { id: '10007' } })).result, true);
});

test('approval requests are rate limited', async () => {
  addIssue(8, 'Bulk SMS campaign to all customers');
  const first = await backend.actionRequestApproval({ issueKey: 'PRIV-8' });
  const second = await backend.actionRequestApproval({ issueKey: 'PRIV-8' });
  assert.equal(first.posted, true);
  assert.equal(second.posted, false);
});

test('governance: named approvers lock approval, the approver list and active rules', async () => {
  as('admin-1');
  const set = await admin('saveSettings', { approverAccountIds: ['io-1'] });
  assert.equal(set.ok, true, set.error);
  // The Jira admin is no longer an approver and cannot add themselves back.
  assert.equal(await service.canCurrentUserApprove('admin-1'), false);
  const sneaky = await admin('saveSettings', { approverAccountIds: ['io-1', 'admin-1'] });
  assert.equal(sneaky.ok, false);
  assert.match(sneaky.error, /current approver/);

  // Editing an active rule becomes a proposal; the active version keeps enforcing.
  const rules = await store_.getRules();
  const id = rules.find((r) => r.id === 'popia-identifiers');
  const weakened = await admin('saveRule', { originalId: id.id, rule: { ...id, keywords: 'nothing that matches' } });
  assert.equal(weakened.ok, true, weakened.error);
  assert.match(weakened.notice, /waiting for a named approver/);
  assert.equal((await backend.validateBuild({ issue: { id: '10007' } })).result, true); // dismissed earlier
  addIssue(9, 'Store customer ID numbers');
  assert.equal((await backend.validateBuild({ issue: { id: '10009' } })).result, false, 'old version still enforced');

  // Only one proposal at a time; the proposer can withdraw it.
  const second = await admin('setRuleStatus', { id: 'popia-identifiers', status: 'draft', reason: 'Testing the governance flow' });
  assert.equal(second.ok, false);
  assert.match(second.error, /already waiting/);
  const firstProposal = (await governance.pendingRuleChanges())[0];
  assert.ok(firstProposal.diff.weakening.some((w) => /− phrase/.test(w)), 'approver sees what the edit removes');
  assert.ok(firstProposal.diff.lostExamples.length > 0, 'approver sees examples that no longer match');
  assert.equal(firstProposal.diff.weakens, true);
  await admin('withdrawProposal', { id: 'popia-identifiers' });

  // Deactivating needs a reason and, in named mode, an approver's decision.
  const noReason = await admin('setRuleStatus', { id: 'popia-identifiers', status: 'draft' });
  assert.equal(noReason.ok, false);
  const proposal = await admin('setRuleStatus', { id: 'popia-identifiers', status: 'draft', reason: 'Testing the governance flow' });
  assert.equal(proposal.ok, true, proposal.error);
  assert.equal((await store_.getRules()).find((r) => r.id === 'popia-identifiers').status, 'active');
  const pending = (await governance.pendingRuleChanges())[0];

  // The proposer cannot decide; a stale proposal id is refused; the approver decides the exact proposal.
  await assert.rejects(governance.decideRuleChange('popia-identifiers', pending.proposalId, 'apply', 'admin-1'), /named approver/);
  await assert.rejects(governance.decideRuleChange('popia-identifiers', 'stale-id', 'apply', 'io-1'), /changed after you opened it/);
  await governance.decideRuleChange('popia-identifiers', pending.proposalId, 'reject', 'io-1');
  assert.equal((await store_.getRules()).find((r) => r.id === 'popia-identifiers').pending, null);

  // Weakening fail-closed needs an approver.
  const weaken = await admin('saveSettings', { failClosed: false });
  assert.equal(weaken.ok, false);
  const log = await store_.listAudit('admin');
  assert.ok(log.some((e) => /Proposed/.test(e.event)));
  assert.ok(log.some((e) => /Rejected/.test(e.event)));
});

test('exploit A blocked: an admin cannot reset and then name themselves', async () => {
  as('admin-1');
  const req = await admin('requestReset', { reason: 'Information Officer has left the company' });
  assert.equal(req.ok, true, req.error);
  assert.equal((await store_.getSettings()).approverAccountIds.length, 1, 'nothing changes during the waiting period');
  // An approver can cancel it.
  await governance.cancelReset('io-1');
  assert.equal((await store_.getSettings()).pendingReset, null);
  // Let a reset mature, then try to self-appoint.
  await admin('requestReset', { reason: 'Information Officer has left the company' });
  let s = await store_.getSettings();
  store.set('settings', { ...s, pendingReset: { ...s.pendingReset, effectiveAt: Date.now() - 1 } });
  // Even after 72 hours nothing happens until a SECOND Jira admin confirms.
  await governance.applyDueReset();
  assert.equal((await store_.getSettings()).approverAccountIds.length, 1, 'unconfirmed reset never applies');
  assert.equal((await admin('confirmReset')).ok, false, 'the requester cannot confirm their own reset');
  admins.add('admin-2');
  as('admin-2');
  assert.equal((await admin('confirmReset')).ok, true);
  await governance.applyDueReset();
  assert.deepEqual((await store_.getSettings()).approverAccountIds, []);
  // For 30 days the requester cannot approve, weaken, or name the new approvers.
  as('admin-1');
  assert.equal(await service.canCurrentUserApprove('admin-1'), false);
  assert.equal((await admin('saveSettings', { failClosed: false })).ok, false);
  await assert.rejects(governance.setApprovers(['admin-1'], 'admin-1'), /another Jira admin/);
  await assert.rejects(governance.setApprovers(['someone'], 'admin-1'), /another Jira admin/);
  as('admin-2');
  await governance.setApprovers(['io-1'], 'admin-2');
  as('admin-1');
  assert.deepEqual((await store_.getSettings()).approverAccountIds, ['io-1']);
  assert.ok((await store_.listAudit('admin')).some((e) => /Reset to small-team mode took effect/.test(e.event)));
});

test('exploit B blocked: a draft cannot be renamed onto an active rule and delete it', async () => {
  as('admin-1');
  const rules = await store_.getRules();
  const draft = { id: 'scratch-draft', title: 'Scratch', keywords: 'scratch phrase', requirements: JSON.stringify([{ id: 'a', label: 'Why', type: 'answer' }]) };
  store.set('settings', { ...(await store_.getSettings()), approverAccountIds: [] });
  assert.equal((await admin('saveRule', { originalId: null, rule: draft })).ok, true);
  store.set('settings', { ...(await store_.getSettings()), approverAccountIds: ['io-1'] });
  const rename = await admin('saveRule', { originalId: 'scratch-draft', rule: { ...draft, id: 'popia-children' } });
  assert.equal(rename.ok, false);
  assert.match(rename.error, /cannot be changed/);
  assert.equal(rules.filter((r) => r.id === 'popia-children').length, 1);
  const del = await admin('deleteRule', { id: 'popia-children' });
  assert.equal(del.ok, false);
});

test('only drafts can be deleted', async () => {
  as('admin-1');
  const out = await admin('deleteRule', { id: 'popia-children' });
  assert.equal(out.ok, false);
  assert.match(out.error, /Deactivate/);
});

test('separation of duties blocks the reporter and whoever answered', async () => {
  store.set('settings', { ...(await store_.getSettings()), approverAccountIds: ['dev-1', 'dev-2'], separationOfDuties: true });
  as('dev-1');
  await assert.rejects(service.approve('PRIV-9', 'popia-identifiers', 'dev-1'), /Separation of duties/);
  addIssue(14, 'Store customer ID numbers in the CRM', { reporterAccountId: 'someone-else' });
  as('dev-2');
  await service.saveAnswers('PRIV-14', 'popia-identifiers', goodAnswers, 'dev-2');
  await assert.rejects(service.approve('PRIV-14', 'popia-identifiers', 'dev-2'), /you answered/);
  store.set('settings', { ...(await store_.getSettings()), approverAccountIds: ['io-1'], separationOfDuties: false });
});

test('exceptions are capped at 90 days and expire', async () => {
  as('io-1');
  await service.setException('PRIV-8', 'io-1', 'Regulator-approved pilot programme', 500);
  const rec = store.get('rec:10008');
  assert.ok(rec.exception.expiresAt - Date.now() <= 90 * 24 * 3600 * 1000 + 1000);
  rec.exception.expiresAt = Date.now() - 1;
  store.set('rec:10008', rec);
  assert.equal((await service.assess('PRIV-8')).result.status, 'blocked');
});

test('Rovo drafts rules only as drafts and only for admins', async () => {
  const draft = {
    title: 'Location tracking',
    clause: 'Privacy Policy 10.2',
    summary: 'Collecting precise location needs a purpose and retention period.',
    keywords: 'gps location, location tracking, geolocation',
    requirements: JSON.stringify([
      { id: 'purpose', label: 'Purpose of collecting location', type: 'answer', stage: 'build' },
      { id: 'io-approval', label: 'Approval', type: 'approval' },
    ]),
    examplesMatch: 'Add live location tracking for drivers',
    examplesIgnore: 'Move the office location on the map',
  };
  as('dev-1');
  assert.equal((await backend.actionDraftRule(draft)).ok, false);
  as('admin-1');
  const saved = await backend.actionDraftRule(draft, { principal: { accountId: 'admin-1' } });
  assert.equal(saved.ok, true, saved.error);
  assert.equal((await store_.getRules()).find((r) => r.id === saved.ruleId).status, 'draft');
  assert.equal((await backend.actionDraftRule({ ...draft, requirements: 'not json' })).ok, false);
});

test('only an approver can overrule someone else\'s "unsure" with "no"', async () => {
  addIssue(13, 'Tweak the profile page copy');
  as('dev-2');
  await service.declare('PRIV-13', 'unsure', 'dev-2');
  as('dev-1');
  await assert.rejects(service.declare('PRIV-13', 'no', 'dev-1'), /approver/);
});

test('the agent prefers the work item in context over a key in the payload', async () => {
  const out = await backend.actionCheckIssue({ issueKey: 'PRIV-5', context: { jira: { issueKey: 'PRIV-1' } } });
  assert.equal(out.issueKey, 'PRIV-1');
});

test('the agent can declare yes/unsure (adds review) but never "no"', async () => {
  addIssue(12, 'Tweak the onboarding copy');
  const no = await backend.actionDeclare({ issueKey: 'PRIV-12', impact: 'no' });
  assert.equal(no.ok, false);
  const unsure = await backend.actionDeclare({ issueKey: 'PRIV-12', impact: 'unsure' }, { principal: { accountId: 'dev-1' } });
  assert.equal(unsure.ok, true, unsure.error);
  assert.ok(unsure.rules.some((r) => r.ruleId === 'popia-personal-info'));
});

test('agent output is redacted and never claims compliance', async () => {
  addIssue(10, 'Store SA ID number 9001015800087 for jane@example.com');
  const out = await backend.actionCheckIssue({ issueKey: 'PRIV-10' });
  const text = JSON.stringify(out);
  assert.ok(!/9001015800087|jane@example/.test(text));
  assert.match(out.note, /untrusted/);
  const none = await backend.actionCheckIssue({ issueKey: 'PRIV-5' });
  assert.match(none.statusMeaning, /not a statement that the work has no privacy impact/);
});

test('deleting a work item removes its evidence but keeps the audit history', async () => {
  assert.ok(store.has('rec:10008'));
  await backend.onIssueDeletedEvent({ issue: { id: '10008', key: 'PRIV-8' } });
  assert.equal(store.has('rec:10008'), false);
  assert.match((await store_.listAudit('10008'))[0].event, /deleted; Preflight evidence removed/);
});

test('validator fails closed by default, logs it, and fails open when configured', async () => {
  const held = await backend.validateDone({ issue: { id: 'missing' } });
  assert.equal(held.result, false);
  assert.match(held.errorMessage, /fail-closed/);
  assert.match((await store_.listAudit('missing'))[0].event, /could not evaluate/);
  store.set('settings', { ...(await store_.getSettings()), failClosed: false });
  assert.equal((await backend.validateDone({ issue: { id: 'missing' } })).result, true);
  store.set('settings', { ...(await store_.getSettings()), failClosed: true });
});

test('locks serialise concurrent updates so no answer is lost', async () => {
  addIssue(11, 'Add SA ID number field to the HR system');
  await service.assess('PRIV-11');
  as('dev-1');
  await Promise.all([
    service.saveAnswers('PRIV-11', 'popia-identifiers', { purpose: goodAnswers.purpose }, 'dev-1'),
    service.saveAnswers('PRIV-11', 'popia-identifiers', { retention: goodAnswers.retention }, 'dev-2'),
  ]);
  const rec = store.get('rec:10011');
  assert.ok(rec.answers['popia-identifiers'].purpose && rec.answers['popia-identifiers'].retention);
  assert.equal([...store.keys()].some((k) => k.startsWith('lock:')), false, 'locks released');
});

test('coverage check reports unprotected transitions', async () => {
  coverageRows = [
    { workflow: 'Software', transition: 'Start', stage: 'build', protected: true },
    { workflow: 'Bug', transition: 'Resolve', stage: 'done', protected: false },
  ];
  as('admin-1');
  const out = await admin('checkCoverage');
  assert.equal(out.coverage.filter((r) => !r.protected).length, 1);
});
