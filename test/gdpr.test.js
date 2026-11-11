/** The GDPR starter pack: valid rules, its own examples pass, and EEA-aware transfers. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluate, checkExamples } from '../src/engine/evaluate.js';
import { GDPR_RULES, GDPR_DEMO_ISSUES } from '../src/rulepacks/gdpr.js';
import { cleanRule } from '../src/rules.js';

const active = GDPR_RULES.map((r) => ({ ...r, status: 'active' }));
const ids = (text) => evaluate({ text }, active, {}).applicable.map((m) => m.ruleId);

test('GDPR pack: every rule is valid, needs an approver, and passes its own examples', () => {
  assert.equal(GDPR_RULES.length, 7);
  for (const r of GDPR_RULES) {
    assert.doesNotThrow(() => cleanRule(r, null), r.id);
    assert.ok(r.requirements.some((q) => q.type === 'approval'), `${r.id} needs approval`);
    assert.deepEqual(checkExamples(r), [], r.id);
    assert.match(r.clause, /GDPR/);
  }
  assert.equal(GDPR_RULES.filter((r) => r.declaration).map((r) => r.id).join(), 'gdpr-personal-info');
});

test('GDPR pack: hosting inside the EEA is not a transfer; outside it is', () => {
  assert.ok(!ids('Migrate customer database to vendor hosted in Ireland').includes('gdpr-cross-border'));
  assert.ok(!ids('Move backups to the eu-west region').includes('gdpr-cross-border'));
  assert.ok(ids('Move customer database backups to a vendor in South Africa').includes('gdpr-cross-border'));
  assert.ok(ids('Sync customer list to our US-based CRM vendor').includes('gdpr-cross-border'));
});

test('GDPR pack: EU identifiers and lawful bases', () => {
  assert.ok(ids('Store the employee national insurance number in payroll').includes('gdpr-identifiers'));
  assert.ok(ids('Capture BSN at onboarding').includes('gdpr-identifiers'));
  const basis = GDPR_RULES.find((r) => r.id === 'gdpr-identifiers').requirements.find((q) => q.id === 'lawful-basis');
  assert.ok(basis.options.every((o) => /Art 6\(1\)/.test(o)));
});

test('GDPR demo: four items match, the footer change does not', () => {
  const matched = GDPR_DEMO_ISSUES.map((d) => ids(`${d.summary}\n${d.description}`).length > 0);
  assert.deepEqual(matched, [true, true, true, true, false]);
});
