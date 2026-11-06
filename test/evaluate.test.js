import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluate, findKeywordHits, answersFingerprint } from '../src/engine/evaluate.js';
import { POPIA_RULES, DEMO_ISSUES } from '../src/rulepacks/popia.js';

const active = POPIA_RULES.map((r) => ({ ...r, status: 'active', updatedAt: 1000 }));
const textOf = (i) => `${i.summary}\n${i.description}`;

test('keyword matching respects word boundaries', () => {
  assert.deepEqual(findKeywordHits('We paid the invoice', ['id number']), []);
  assert.deepEqual(findKeywordHits('Capture SA ID-number at signup', ['id number']), ['id number']);
  assert.deepEqual(findKeywordHits('Fix race condition in queue', ['racial', 'race or ethnic']), []);
  assert.deepEqual(findKeywordHits('Add /health check endpoint', ['health data', 'health record']), []);
});

test('demo tickets hit the intended rules and the control ticket hits none', () => {
  const ids = (i) => evaluate({ text: textOf(DEMO_ISSUES[i]) }, active, {}).applicable.map((m) => m.ruleId).sort();
  assert.ok(ids(0).includes('popia-identifiers'));
  assert.deepEqual(ids(1), ['popia-children', 'popia-special']);
  assert.ok(ids(2).includes('popia-direct-marketing'));
  assert.ok(ids(3).includes('popia-cross-border'));
  assert.deepEqual(ids(4), []);
  assert.equal(evaluate({ text: textOf(DEMO_ISSUES[4]) }, active, {}).status, 'not-applicable');
});

test('drafts are never enforced', () => {
  const drafts = POPIA_RULES.map((r) => ({ ...r, status: 'draft' }));
  assert.equal(evaluate({ text: textOf(DEMO_ISSUES[0]) }, drafts, {}).status, 'not-applicable');
});

test('blocked until answers and approval exist, then clear', () => {
  const work = { text: textOf(DEMO_ISSUES[0]) };
  const rules = active.filter((r) => r.id === 'popia-identifiers');
  assert.equal(evaluate(work, rules, {}).status, 'blocked');
  assert.equal(evaluate(work, rules, {}).openCount, 4);

  const answers = {
    'popia-identifiers': {
      purpose: { value: 'Verify callers against FICA records' },
      minimality: { value: 'Date of birth is shared by many customers' },
      retention: { value: 'Deleted 5 years after account closure' },
    },
  };
  const partial = evaluate(work, rules, { answers });
  assert.equal(partial.openCount, 1);
  assert.match(partial.summary, /approval/);

  const fingerprint = answersFingerprint(answers['popia-identifiers']);
  const approved = { answers, approvals: { 'popia-identifiers': { by: 'acc-1', at: 2000, fingerprint } } };
  assert.equal(evaluate(work, rules, approved).status, 'clear');
});

test('approval goes stale when answers or the rule change afterwards', () => {
  const work = { text: textOf(DEMO_ISSUES[0]) };
  const rules = active.filter((r) => r.id === 'popia-identifiers');
  const answers = {
    'popia-identifiers': {
      purpose: { value: 'Verify callers against FICA records' },
      minimality: { value: 'Date of birth is shared by many customers' },
      retention: { value: 'Deleted 5 years after account closure' },
    },
  };
  const fingerprint = answersFingerprint(answers['popia-identifiers']);
  const record = { answers, approvals: { 'popia-identifiers': { by: 'a', at: 2000, fingerprint } } };

  const edited = structuredClone(record);
  edited.answers['popia-identifiers'].retention.value = 'Kept forever';
  assert.equal(evaluate(work, rules, edited).status, 'blocked');

  const ruleChanged = rules.map((r) => ({ ...r, updatedAt: 3000 }));
  const result = evaluate(work, ruleChanged, record);
  assert.equal(result.status, 'blocked');
  assert.match(result.open[0].reason, /rule changed/);
});

test('choice and link requirements are validated', () => {
  const work = { text: textOf(DEMO_ISSUES[1]) };
  const rules = active.filter((r) => r.id === 'popia-special');
  const record = { answers: { 'popia-special': { basis: { value: 'Because we want to' }, safeguards: { value: 'see wiki' } } } };
  const reasons = evaluate(work, rules, record).open.map((o) => o.reason);
  assert.ok(reasons.includes('Pick one of the listed options'));
  assert.ok(reasons.includes('Must be a link (https://…)'));
});

test('dismissal and manual flag', () => {
  const work = { text: textOf(DEMO_ISSUES[4]) };
  const manual = evaluate(work, active, { manual: ['popia-bulk-export'] });
  assert.equal(manual.status, 'blocked');
  assert.equal(manual.applicable[0].why.manual, true);

  const dm = evaluate({ text: textOf(DEMO_ISSUES[2]) }, active, {
    dismissals: { 'popia-direct-marketing': { by: 'a', reason: 'Internal staff only' } },
  });
  assert.equal(dm.dismissed.length, 1);
  assert.ok(!dm.applicable.some((m) => m.ruleId === 'popia-direct-marketing'));
});

test('exception unblocks but is reported as exception, not clear', () => {
  const result = evaluate({ text: textOf(DEMO_ISSUES[0]) }, active, { exception: { by: 'a', reason: 'Regulator-approved pilot' } });
  assert.equal(result.status, 'exception');
});
