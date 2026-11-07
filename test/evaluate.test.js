import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluate, findKeywordHits, answersFingerprint, redact, stem, answerQuality, checkExamples, matchTriggers,
} from '../src/engine/evaluate.js';
import { POPIA_RULES, DEMO_ISSUES, DECLARATION_RULE_ID } from '../src/rulepacks/popia.js';

const active = POPIA_RULES.map((r) => ({ ...r, status: 'active', updatedAt: 1000 }));
const textOf = (i) => `${i.summary}\n${i.description}`;
const idRule = active.filter((r) => r.id === 'popia-identifiers');
const goodAnswers = {
  'popia-identifiers': {
    purpose: { value: 'Verify callers against FICA records before account changes' },
    minimality: { value: 'Date of birth is shared by many customers, so it cannot verify identity' },
    'lawful-basis': { value: 'Required to comply with an obligation imposed by law' },
    retention: { value: 'Deleted five years after the account is closed, as FICA requires' },
  },
};

test('stemming makes plurals match', () => {
  assert.equal(stem('numbers'), 'number');
  assert.equal(stem('addresses'), 'address');
  assert.equal(stem('ids'), 'id');
  assert.equal(stem('status'), 'status');
  assert.deepEqual(findKeywordHits('Store customer ID numbers', ['id number']), ['id number']);
});

test('word boundaries and global excludes', () => {
  assert.deepEqual(findKeywordHits('We paid the invoice', ['id number']), []);
  assert.deepEqual(findKeywordHits('Fix race condition in queue', ['race']), []);
  assert.deepEqual(findKeywordHits('Add /health check endpoint', ['health']), []);
  assert.deepEqual(findKeywordHits('Create child issues for epic', ['child']), []);
});

test('contextual triggers need their companion words', () => {
  const triggers = { contextual: [{ terms: ['promo'], with: ['sms', 'email'] }] };
  assert.deepEqual(matchTriggers('Send promo SMS', triggers).keywords, ['promo']);
  assert.deepEqual(matchTriggers('Promo banner colours', triggers).keywords, []);
});

test('every starter rule passes its own examples', () => {
  for (const rule of POPIA_RULES) assert.deepEqual(checkExamples(rule), [], rule.id);
});

test('demo tickets hit the intended rules; the control ticket hits none', () => {
  const ids = (i) => evaluate({ text: textOf(DEMO_ISSUES[i]) }, active, {}).applicable.map((m) => m.ruleId);
  assert.ok(ids(0).includes('popia-identifiers'));
  assert.ok(ids(1).includes('popia-special') && ids(1).includes('popia-children'));
  assert.ok(ids(2).includes('popia-direct-marketing'));
  assert.ok(ids(3).includes('popia-cross-border'));
  assert.deepEqual(ids(4), []);
});

test('drafts are never enforced', () => {
  const drafts = POPIA_RULES.map((r) => ({ ...r, status: 'draft' }));
  assert.equal(evaluate({ text: textOf(DEMO_ISSUES[0]) }, drafts, {}).status, 'not-applicable');
});

test('two stages: build needs answers + approval, done also needs ship-time evidence', () => {
  const work = { text: textOf(DEMO_ISSUES[0]) };
  const empty = evaluate(work, idRule, {});
  assert.equal(empty.stages.build.status, 'blocked');
  assert.equal(empty.stages.build.open.length, 5); // 4 answers + approval
  assert.equal(empty.stages.done.open.length, 6); // + privacy notice link

  const fp = answersFingerprint(goodAnswers['popia-identifiers'], idRule[0]);
  const approved = { answers: goodAnswers, approvals: { 'popia-identifiers': { by: 'io', at: 2000, fingerprint: fp } } };
  const r = evaluate(work, idRule, approved);
  assert.equal(r.stages.build.status, 'clear');
  assert.equal(r.stages.done.status, 'blocked');
  assert.match(r.stages.done.summary, /Privacy notice/);

  const withNotice = structuredClone(approved);
  withNotice.answers['popia-identifiers'].notification = { value: 'https://wiki.example.com/privacy-notice' };
  const done = evaluate(work, idRule, withNotice);
  assert.equal(done.status, 'clear');
  // Adding the done-stage link did not make the approval stale.
  assert.ok(done.applicable[0].requirements.find((q) => q.type === 'approval').satisfied);
});

test('approval goes stale when build answers or the rule change afterwards', () => {
  const work = { text: textOf(DEMO_ISSUES[0]) };
  const fp = answersFingerprint(goodAnswers['popia-identifiers'], idRule[0]);
  const record = { answers: structuredClone(goodAnswers), approvals: { 'popia-identifiers': { by: 'a', at: 2000, fingerprint: fp } } };
  record.answers['popia-identifiers'].retention.value = 'Kept forever for analytics purposes';
  assert.equal(evaluate(work, idRule, record).stages.build.status, 'blocked');

  const fresh = { answers: goodAnswers, approvals: { 'popia-identifiers': { by: 'a', at: 2000, fingerprint: fp } } };
  const changed = evaluate(work, idRule.map((r) => ({ ...r, updatedAt: 3000 })), fresh);
  assert.match(changed.stages.build.open[0].reason, /rule changed/);
});

test('answer quality: filler does not count as evidence', () => {
  assert.ok(answerQuality('aaaaaaaaaaaaaaaaaaaa'));
  assert.ok(answerQuality('n/a'));
  assert.ok(answerQuality('see above'));
  assert.ok(answerQuality('test test test test'));
  assert.equal(answerQuality('Verify callers against FICA records'), null);
  const r = evaluate({ text: 'Add SA ID number field' }, idRule, { answers: { 'popia-identifiers': { purpose: { value: 'xxxxxxxxxxxxxx' } } } });
  assert.match(r.open.find((o) => o.id === 'purpose').reason, /real answer/);
});

test('choice and link requirements are validated', () => {
  const rules = active.filter((r) => r.id === 'popia-special');
  const record = { answers: { 'popia-special': { basis: { value: 'Because we want to' }, safeguards: { value: 'see wiki' } } } };
  const reasons = evaluate({ text: 'Store patients medical records' }, rules, record).open.map((o) => o.reason);
  assert.ok(reasons.includes('Pick one of the listed options'));
  assert.ok(reasons.includes('Must be a link (https://…)'));
});

test('sticky matches survive rewording; dismissal removes them', () => {
  const record = { matched: { 'popia-identifiers': { at: 1, phrases: ['id number'] } } };
  const reworded = evaluate({ text: 'Capture a reference at signup' }, active, record);
  assert.equal(reworded.applicable[0].ruleId, 'popia-identifiers');
  assert.equal(reworded.applicable[0].why.sticky, true);
  const dismissed = evaluate({ text: 'Capture a reference at signup' }, active, { ...record, dismissals: { 'popia-identifiers': { by: 'a', reason: 'Not an identifier at all' } } });
  assert.equal(dismissed.status, 'not-applicable');
});

test('declaration: Unsure pulls in the general rule; required declaration blocks build only', () => {
  const opts = { declarationRuleId: DECLARATION_RULE_ID, requireDeclaration: true };
  const none = evaluate({ text: 'Update footer copyright year' }, active, {}, opts);
  assert.equal(none.stages.build.status, 'blocked');
  assert.equal(none.stages.build.needsDeclaration, true);
  assert.equal(none.stages.done.status, 'not-applicable');
  const no = evaluate({ text: 'Update footer copyright year' }, active, { declaration: { value: 'no' } }, opts);
  assert.equal(no.stages.build.status, 'not-applicable');
  const unsure = evaluate({ text: 'Update footer copyright year' }, active, { declaration: { value: 'unsure' } }, opts);
  assert.deepEqual(unsure.applicable.map((m) => m.ruleId), [DECLARATION_RULE_ID]);
  assert.equal(unsure.applicable[0].why.declared, true);
});

test('exceptions apply until they expire', () => {
  const work = { text: textOf(DEMO_ISSUES[0]) };
  assert.equal(evaluate(work, active, { exception: { by: 'a', reason: 'pilot', expiresAt: 5000 } }, { now: 4000 }).status, 'exception');
  const expired = evaluate(work, active, { exception: { by: 'a', reason: 'pilot', expiresAt: 5000 } }, { now: 6000 });
  assert.equal(expired.status, 'blocked');
  assert.match(expired.summary, /expired/);
});

test('redaction removes ID numbers, phone numbers and e-mails from snippets', () => {
  assert.equal(redact('Customer 9001015800087 on +27 11 555 0100'), 'Customer [number removed] on [number removed]');
  assert.equal(redact('mail jane.doe@example.co.za now'), 'mail [email removed] now');
  const r = evaluate({ text: 'Store SA ID number 9001015800087 for jane@example.com' }, active, {});
  assert.ok(!/9001015800087|jane@/.test(r.applicable[0].why.snippet));
});

test('no match is reported as "no configured rule matched", never as compliant', () => {
  assert.match(evaluate({ text: 'Update footer copyright year' }, active, {}).summary, /No configured privacy rule matched/);
});
