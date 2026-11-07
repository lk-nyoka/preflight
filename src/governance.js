/**
 * Rule and settings governance.
 *
 * Problem this solves: a Jira admin could otherwise quietly weaken the controls
 * (edit an active rule, deactivate it, add themselves as approver, switch to
 * fail-open) with no trace.
 *
 *   Small-team mode (no named approvers): admins apply changes directly.
 *   Named-approver mode: admins PROPOSE changes to active rules and to
 *   weakening settings; a named approver applies or rejects them in the
 *   Preflight reviews page. Drafts can always be edited freely, because drafts
 *   enforce nothing.
 *
 * Every change, proposal and decision is written to the write-once admin audit log.
 */
import { getRules, saveRules, getSettings, saveSettings, appendAudit, listAudit } from './store.js';
import { currentUserIsJiraAdmin } from './jira.js';
import { cleanRule } from './rules.js';
import { PreflightError } from './errors.js';

const now = () => Date.now();

async function mode() {
  const settings = await getSettings();
  return { settings, named: settings.approverAccountIds.length > 0 };
}

const isApprover = (settings, actor) => settings.approverAccountIds.includes(actor);

function summariseChange(before, after) {
  if (!before) return 'new rule';
  const changes = [];
  for (const field of ['title', 'clause', 'summary', 'severity', 'policyRef']) if (before[field] !== after[field]) changes.push(field);
  if (JSON.stringify(before.triggers) !== JSON.stringify(after.triggers)) changes.push('triggers');
  if (JSON.stringify(before.requirements) !== JSON.stringify(after.requirements)) changes.push('requirements');
  return changes.length ? `changed ${changes.join(', ')}` : 'no effective change';
}

/* ---------------- rules ---------------- */

export async function saveRuleChange(input, originalId, actor) {
  const rules = await getRules();
  const index = rules.findIndex((r) => r.id === originalId);
  const existing = index >= 0 ? rules[index] : null;
  const cleaned = cleanRule(input, existing);
  if (!existing && rules.some((r) => r.id === cleaned.id)) throw new PreflightError(`A rule with id ${cleaned.id} already exists.`);
  const { settings, named } = await mode();

  if (existing && existing.status === 'active' && named && !isApprover(settings, actor)) {
    rules[index] = { ...existing, pending: { kind: 'edit', rule: { ...cleaned, status: 'active' }, by: actor, at: now() } };
    await saveRules(rules);
    await appendAudit('admin', { by: actor, action: 'rule.change.proposed', ruleId: existing.id, event: `Proposed edit to active rule "${existing.title}" (${summariseChange(existing, cleaned)})` });
    return { rules, notice: 'This rule is active, so your edit is waiting for a named approver in Preflight reviews. The current version keeps enforcing until then.' };
  }

  const next = { ...cleaned, status: existing?.status || 'draft', pending: null };
  if (index >= 0) rules[index] = next;
  else rules.push(next);
  await saveRules(rules);
  await appendAudit('admin', { by: actor, action: 'rule.saved', ruleId: next.id, event: `Saved ${next.status} rule "${next.title}" (${summariseChange(existing, next)})` });
  return { rules, notice: `Saved "${next.title}".${next.status === 'active' ? ' Approvals given before this edit now need re-approval.' : ''}` };
}

export async function setRuleStatusChange(id, status, actor, reason = '') {
  const rules = await getRules();
  const rule = rules.find((r) => r.id === id);
  if (!rule) throw new PreflightError('Rule not found.');
  const target = status === 'active' ? 'active' : 'draft';
  if (rule.status === target) return { rules, notice: 'No change.' };
  if (target === 'draft' && String(reason || '').trim().length < 10) {
    throw new PreflightError('Give a reason (at least 10 characters) for deactivating an active rule.');
  }
  const { settings, named } = await mode();

  if (named && !isApprover(settings, actor)) {
    rule.pending = { kind: target === 'active' ? 'activate' : 'deactivate', by: actor, at: now(), reason: String(reason).slice(0, 300) };
    await saveRules(rules);
    await appendAudit('admin', { by: actor, action: `rule.${rule.pending.kind}.proposed`, ruleId: id, event: `Proposed to ${rule.pending.kind} "${rule.title}"${reason ? `: ${reason}` : ''}` });
    return { rules, notice: `Waiting for a named approver to ${rule.pending.kind} "${rule.title}" in Preflight reviews.` };
  }
  applyStatus(rule, target, actor);
  rule.pending = null;
  await saveRules(rules);
  await appendAudit('admin', { by: actor, action: target === 'active' ? 'rule.activated' : 'rule.deactivated', ruleId: id, event: `${target === 'active' ? 'Activated' : 'Deactivated'} "${rule.title}"${reason ? `: ${reason}` : ''}` });
  return { rules, notice: null };
}

function applyStatus(rule, target, actor) {
  rule.status = target;
  rule.activatedBy = target === 'active' ? actor : null;
  rule.activatedAt = target === 'active' ? now() : null;
}

/** Only drafts can be deleted, so deleting can never silently clear blocked work. */
export async function deleteRuleChange(id, actor) {
  const rules = await getRules();
  const rule = rules.find((r) => r.id === id);
  if (!rule) throw new PreflightError('Rule not found.');
  if (rule.status === 'active') throw new PreflightError('Deactivate the rule before deleting it.');
  await saveRules(rules.filter((r) => r.id !== id));
  await appendAudit('admin', { by: actor, action: 'rule.deleted', ruleId: id, event: `Deleted draft rule "${rule.title}"` });
  return { rules: await getRules() };
}

export async function pendingRuleChanges() {
  return (await getRules()).filter((r) => r.pending).map((r) => ({
    ruleId: r.id, title: r.title, clause: r.clause, status: r.status, kind: r.pending.kind, by: r.pending.by, at: r.pending.at,
    change: r.pending.kind === 'edit' ? summariseChange(r, r.pending.rule) : null,
    proposed: r.pending.kind === 'edit' ? { triggers: r.pending.rule.triggers, requirements: r.pending.rule.requirements.map((q) => q.label) } : null,
  }));
}

/** A named approver applies or rejects a proposal. The proposer cannot decide their own proposal. */
export async function decideRuleChange(id, decision, actor) {
  const { settings, named } = await mode();
  if (!named || !isApprover(settings, actor)) throw new PreflightError('Only a named approver can decide rule changes.');
  const rules = await getRules();
  const index = rules.findIndex((r) => r.id === id);
  const rule = rules[index];
  if (!rule?.pending) throw new PreflightError('There is no pending change for this rule.');
  if (rule.pending.by === actor) throw new PreflightError('You cannot decide a change you proposed.');
  const { kind } = rule.pending;
  if (decision === 'apply') {
    if (kind === 'edit') rules[index] = { ...rule.pending.rule, status: rule.status, activatedBy: rule.activatedBy, activatedAt: rule.activatedAt, updatedAt: now(), pending: null };
    else {
      applyStatus(rule, kind === 'activate' ? 'active' : 'draft', actor);
      rule.pending = null;
    }
  } else {
    rule.pending = null;
  }
  await saveRules(rules);
  await appendAudit('admin', { by: actor, action: `rule.${kind}.${decision === 'apply' ? 'applied' : 'rejected'}`, ruleId: id, event: `${decision === 'apply' ? 'Applied' : 'Rejected'} proposal to ${kind} "${rule.title}"` });
  return { rules };
}

/* ---------------- settings ---------------- */

/**
 * Approver list. First setup (empty list) can be done by an admin. After that,
 * only a current approver can change it, so an admin cannot add themselves.
 * An admin can reset to small-team mode (for example if the Information
 * Officer has left); that is audited and visible on the admin page.
 */
export async function setApprovers(list, actor) {
  const clean = [...new Set((list || []).filter((id) => typeof id === 'string' && id))].slice(0, 20);
  const { settings, named } = await mode();
  if (named && !isApprover(settings, actor)) {
    throw new PreflightError('Only a current approver can change the approver list. A Jira admin can reset to small-team mode instead (this is audited).');
  }
  if (named && !clean.length) throw new PreflightError('Keep at least one approver, or use "Reset to small-team mode".');
  await saveSettings({ approverAccountIds: clean });
  await appendAudit('admin', { by: actor, action: named ? 'approvers.changed' : 'approvers.set', event: `Approvers ${named ? 'changed' : 'set'}: ${clean.length} named`, details: { before: settings.approverAccountIds, after: clean } });
  return getSettings();
}

export async function resetApprovers(actor, reason) {
  if (String(reason || '').trim().length < 10) throw new PreflightError('Give a reason for resetting the approvers.');
  const { settings } = await mode();
  await saveSettings({ approverAccountIds: [] });
  await appendAudit('admin', { by: actor, action: 'approvers.reset', event: `Reset to small-team mode: ${String(reason).slice(0, 200)}`, details: { before: settings.approverAccountIds } });
  return getSettings();
}

/** Weakening a control (fail-open, separation of duties off) needs an approver in named mode. */
export async function setPolicy(patch, actor) {
  const { settings, named } = await mode();
  const next = {};
  if (typeof patch.failClosed === 'boolean') next.failClosed = patch.failClosed;
  if (typeof patch.separationOfDuties === 'boolean') next.separationOfDuties = patch.separationOfDuties;
  if (typeof patch.requireDeclaration === 'boolean') next.requireDeclaration = patch.requireDeclaration;
  if (!Object.keys(next).length) return settings;
  const weakening =
    (next.failClosed === false && settings.failClosed) ||
    (next.separationOfDuties === false && settings.separationOfDuties) ||
    (next.requireDeclaration === false && settings.requireDeclaration);
  if (weakening && named && !isApprover(settings, actor)) throw new PreflightError('Only a named approver can weaken a control.');
  await saveSettings(next);
  await appendAudit('admin', { by: actor, action: 'settings.changed', event: `Settings: ${Object.entries(next).map(([k, v]) => `${k}=${v}`).join(', ')}`, details: { before: { failClosed: settings.failClosed, separationOfDuties: settings.separationOfDuties, requireDeclaration: settings.requireDeclaration } } });
  return getSettings();
}

export const adminAudit = (limit = 50) => listAudit('admin', { limit });

/**
 * Save a DRAFT rule proposed by the Rovo agent from a policy page. Drafts are
 * never enforced; activating one is a separate, governed step.
 */
export async function draftRuleFromPolicy(input, actor) {
  if (!(await currentUserIsJiraAdmin())) throw new PreflightError('Only Jira administrators can add Preflight rules.');
  const rules = await getRules();
  let id = String(input.ruleId || input.title || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50);
  if (id.length < 3) id = `rule-${Date.now().toString(36)}`;
  while (rules.some((r) => r.id === id)) id = `${id.slice(0, 45)}-${Math.random().toString(36).slice(2, 5)}`;
  const rule = { ...cleanRule({ ...input, id }, null), status: 'draft', source: { kind: 'rovo-draft', url: input.sourceUrl || null, by: actor, at: now() } };
  await saveRules([...rules, rule]);
  await appendAudit('admin', { by: actor, via: 'agent', action: 'rule.drafted', ruleId: rule.id, event: `Rovo drafted rule "${rule.title}" from ${input.sourceUrl || 'a policy'} (draft, not enforced)` });
  return rule;
}
