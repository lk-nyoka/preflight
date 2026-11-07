/**
 * Rule and settings governance.
 *
 * Problem this solves: a Jira admin could otherwise quietly weaken the controls
 * (edit or delete an active rule, add themselves as approver, switch to
 * fail-open) with no trace.
 *
 *   Small-team mode (no named approvers): admins apply changes directly.
 *   Named-approver mode:
 *     - edits, activation and deactivation of rules by a non-approver become
 *       PROPOSALS, pinned to a proposal id, that a named approver applies or
 *       rejects (never the proposer). The current version keeps enforcing.
 *     - only a current approver can change the approver list or weaken a control.
 *     - a non-approver admin can request a break-glass RESET to small-team mode
 *       (for when the Information Officer has left). It takes effect after 72
 *       hours, any approver can cancel it, and the requester cannot then name
 *       themselves approver.
 *
 * Every change, proposal and decision is written to the write-once admin audit log.
 * All mutations run under one lock, so concurrent admin and approver actions
 * cannot lose each other's updates.
 */
import { getRules, saveRules, getSettings, saveSettings, appendAudit, listAudit, withLock } from './store.js';
import { cleanRule } from './rules.js';
import { PreflightError } from './errors.js';
import { currentUserIsJiraAdmin } from './jira.js';
import { redact } from './engine/evaluate.js';

const now = () => Date.now();
const RESET_DELAY_MS = 72 * 60 * 60 * 1000;
const locked = (fn) => (...args) => withLock('governance', () => fn(...args));
const newId = () => `${now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
const audit = (actor, action, event, extra = {}) => appendAudit('admin', { by: actor, via: 'admin', action, event, ...extra });

async function mode() {
  const settings = await getSettings();
  return { settings, named: settings.approverAccountIds.length > 0 };
}
const isApprover = (settings, actor) => settings.approverAccountIds.includes(actor);
const substantive = (r) => JSON.stringify({ t: r.title, c: r.clause, s: r.summary, tr: r.triggers, rq: r.requirements, sev: r.severity });

/** Field-level diff an approver can actually judge, including requirement types and stages. */
function diff(before, after) {
  if (!before) return { summary: 'new rule' };
  const kw = (r) => new Set([...(r.triggers?.keywords || []), ...(r.triggers?.contextual || []).flatMap((g) => g.terms)]);
  const req = (r) => new Map((r.requirements || []).map((q) => [q.id, `${q.label} [${q.type}, ${q.type === 'approval' ? 'build' : q.stage || 'build'}]`]));
  const [kb, ka, rb, ra] = [kw(before), kw(after), req(before), req(after)];
  const out = {
    phrasesAdded: [...ka].filter((x) => !kb.has(x)),
    phrasesRemoved: [...kb].filter((x) => !ka.has(x)),
    requirementsAdded: [...ra.keys()].filter((k) => !rb.has(k)).map((k) => ra.get(k)),
    requirementsRemoved: [...rb.keys()].filter((k) => !ra.has(k)).map((k) => rb.get(k)),
    requirementsChanged: [...ra.keys()].filter((k) => rb.has(k) && rb.get(k) !== ra.get(k)).map((k) => `${rb.get(k)} → ${ra.get(k)}`),
    textChanged: ['title', 'clause', 'summary', 'severity'].filter((f) => before[f] !== after[f]),
  };
  const parts = [];
  if (out.phrasesAdded.length) parts.push(`+${out.phrasesAdded.length} phrases`);
  if (out.phrasesRemoved.length) parts.push(`−${out.phrasesRemoved.length} phrases`);
  if (out.requirementsAdded.length) parts.push(`+${out.requirementsAdded.length} requirements`);
  if (out.requirementsRemoved.length) parts.push(`−${out.requirementsRemoved.length} requirements`);
  if (out.requirementsChanged.length) parts.push(`${out.requirementsChanged.length} requirements changed`);
  if (out.textChanged.length) parts.push(`text: ${out.textChanged.join(', ')}`);
  out.summary = parts.join('; ') || 'no effective change';
  out.weakens = out.phrasesRemoved.length > 0 || out.requirementsRemoved.length > 0 || out.requirementsChanged.length > 0;
  return out;
}

/* ---------------- rules ---------------- */

export const saveRuleChange = locked(async (input, originalId, actor) => {
  const rules = await getRules();
  const index = originalId ? rules.findIndex((r) => r.id === originalId) : -1;
  const existing = index >= 0 ? rules[index] : null;
  if (originalId && !existing) throw new PreflightError('Rule not found.');
  if (existing && input.id && input.id !== existing.id) throw new PreflightError('A rule id cannot be changed. Create a new rule instead.');
  const id = existing ? existing.id : input.id;
  if (!existing && rules.some((r) => r.id === id)) throw new PreflightError(`A rule with id ${id} already exists.`);
  let cleaned = cleanRule({ ...input, id }, existing);
  // Only a substantive change bumps the version (which makes existing approvals stale).
  if (existing && substantive(existing) === substantive(cleaned)) cleaned = { ...cleaned, updatedAt: existing.updatedAt };
  const { settings, named } = await mode();
  const change = diff(existing, cleaned);

  if (existing && existing.status === 'active' && named && !isApprover(settings, actor)) {
    if (existing.pending) throw new PreflightError('A change to this rule is already waiting for an approver. Withdraw it first.');
    rules[index] = { ...existing, pending: { id: newId(), kind: 'edit', rule: { ...cleaned, status: 'active', pending: null }, by: actor, at: now(), diff: change } };
    await saveRules(rules);
    await audit(actor, 'rule.change.proposed', `Proposed edit to active rule "${existing.title}" (${change.summary})`, { ruleId: id });
    return { rules, notice: 'This rule is active, so your edit is waiting for a named approver in Preflight reviews. The current version keeps enforcing until then.' };
  }

  const next = { ...cleaned, status: existing?.status || 'draft', pending: null };
  if (existing) rules[index] = next;
  else rules.push(next);
  await saveRules(rules);
  await audit(actor, 'rule.saved', `${existing ? 'Edited' : 'Created'} ${next.status} rule "${next.title}" (${change.summary})${existing?.pending ? '; replaced a pending proposal' : ''}`, { ruleId: id, ruleVersion: next.updatedAt });
  const stale = next.status === 'active' && existing && next.updatedAt !== existing.updatedAt;
  return { rules, notice: `Saved "${next.title}".${stale ? ' Approvals given before this edit now need re-approval.' : ''}` };
});

export const setRuleStatusChange = locked(async (id, status, actor, reason = '') => {
  const rules = await getRules();
  const index = rules.findIndex((r) => r.id === id);
  const rule = rules[index];
  if (!rule) throw new PreflightError('Rule not found.');
  const target = status === 'active' ? 'active' : 'draft';
  if (rule.status === target) return { rules, notice: 'No change.' };
  if (target === 'draft' && String(reason || '').trim().length < 10) {
    throw new PreflightError('Give a reason (at least 10 characters) for deactivating an active rule.');
  }
  const { settings, named } = await mode();
  if (named && !isApprover(settings, actor)) {
    if (rule.pending) throw new PreflightError('A change to this rule is already waiting for an approver.');
    const kind = target === 'active' ? 'activate' : 'deactivate';
    rule.pending = { id: newId(), kind, by: actor, at: now(), reason: redact(String(reason)).slice(0, 300) };
    await saveRules(rules);
    await audit(actor, `rule.${kind}.proposed`, `Proposed to ${kind} "${rule.title}"${reason ? `: ${redact(reason)}` : ''}`, { ruleId: id });
    return { rules, notice: `Waiting for a named approver to ${kind} "${rule.title}" in Preflight reviews.` };
  }
  applyStatus(rule, target, actor);
  rule.pending = null;
  await saveRules(rules);
  await audit(actor, target === 'active' ? 'rule.activated' : 'rule.deactivated', `${target === 'active' ? 'Activated' : 'Deactivated'} "${rule.title}"${reason ? `: ${redact(reason)}` : ''}`, { ruleId: id });
  return { rules, notice: null };
});

function applyStatus(rule, target, actor) {
  rule.status = target;
  rule.activatedBy = target === 'active' ? actor : null;
  rule.activatedAt = target === 'active' ? now() : null;
}

/** Only drafts with no pending proposal can be deleted. Deletes exactly that rule. */
export const deleteRuleChange = locked(async (id, actor) => {
  const rules = await getRules();
  const index = rules.findIndex((r) => r.id === id);
  const rule = rules[index];
  if (!rule) throw new PreflightError('Rule not found.');
  if (rule.status === 'active') throw new PreflightError('Deactivate the rule before deleting it.');
  if (rule.pending) throw new PreflightError('This rule has a pending proposal. Decide or withdraw it first.');
  rules.splice(index, 1);
  await saveRules(rules);
  await audit(actor, 'rule.deleted', `Deleted draft rule "${rule.title}"`, { ruleId: id });
  return { rules };
});

export const withdrawProposal = locked(async (id, actor) => {
  const rules = await getRules();
  const rule = rules.find((r) => r.id === id);
  if (!rule?.pending) throw new PreflightError('Nothing is pending for this rule.');
  const { settings } = await mode();
  if (rule.pending.by !== actor && !isApprover(settings, actor)) throw new PreflightError('Only the proposer or an approver can withdraw this.');
  rule.pending = null;
  await saveRules(rules);
  await audit(actor, 'rule.change.withdrawn', `Withdrew the pending change to "${rule.title}"`, { ruleId: id });
  return { rules };
});

export async function pendingRuleChanges() {
  return (await getRules()).filter((r) => r.pending).map((r) => ({
    ruleId: r.id, proposalId: r.pending.id, title: r.title, clause: r.clause, status: r.status, kind: r.pending.kind,
    by: r.pending.by, at: r.pending.at, reason: r.pending.reason || null, diff: r.pending.diff || null,
  }));
}

/** A named approver applies or rejects the EXACT proposal they reviewed (proposal id pinned). */
export const decideRuleChange = locked(async (id, proposalId, decision, actor) => {
  const { settings, named } = await mode();
  if (!named || !isApprover(settings, actor)) throw new PreflightError('Only a named approver can decide rule changes.');
  const rules = await getRules();
  const index = rules.findIndex((r) => r.id === id);
  const rule = rules[index];
  if (!rule?.pending) throw new PreflightError('There is no pending change for this rule.');
  if (rule.pending.id !== proposalId) throw new PreflightError('This proposal changed after you opened it. Refresh and review it again.');
  if (rule.pending.by === actor) throw new PreflightError('You cannot decide a change you proposed.');
  const { kind } = rule.pending;
  if (decision === 'apply') {
    if (kind === 'edit') rules[index] = { ...rule.pending.rule, status: rule.status, activatedBy: rule.activatedBy, activatedAt: rule.activatedAt, pending: null };
    else { applyStatus(rule, kind === 'activate' ? 'active' : 'draft', actor); rule.pending = null; }
  } else {
    rule.pending = null;
  }
  await saveRules(rules);
  await audit(actor, `rule.${kind}.${decision === 'apply' ? 'applied' : 'rejected'}`, `${decision === 'apply' ? 'Applied' : 'Rejected'} proposal to ${kind} "${rule.title}"`, { ruleId: id });
  return { rules };
});

/* ---------------- approvers and break-glass reset ---------------- */

/** Apply a reset whose 72-hour waiting period has passed. Called on every governance read. */
export const applyDueReset = locked(async () => {
  const settings = await getSettings();
  const r = settings.pendingReset;
  if (!r || r.effectiveAt > now()) return settings;
  await saveSettings({ approverAccountIds: [], pendingReset: null, resetBy: r.by });
  await audit(r.by, 'approvers.reset', `Reset to small-team mode took effect (requested ${new Date(r.at).toISOString()}): ${r.reason}`, { details: { before: settings.approverAccountIds } });
  return getSettings();
});

export const setApprovers = locked(async (list, actor) => {
  const clean = [...new Set((list || []).filter((id) => typeof id === 'string' && id))].slice(0, 20);
  const { settings, named } = await mode();
  if (named && !isApprover(settings, actor)) {
    throw new PreflightError('Only a current approver can change the approver list. If your approver has left, request a reset (it takes 72 hours and approvers can cancel it).');
  }
  if (named && !clean.length) throw new PreflightError('Keep at least one approver.');
  if (!named && !(await currentUserIsJiraAdmin())) throw new PreflightError('Only a Jira admin can name the first approvers.');
  if (!named && settings.resetBy === actor && clean.includes(actor)) {
    throw new PreflightError('You requested the reset, so you cannot name yourself approver. Name someone else, or ask another admin.');
  }
  await saveSettings({ approverAccountIds: clean, pendingReset: null });
  await audit(actor, named ? 'approvers.changed' : 'approvers.set', `Approvers ${named ? 'changed' : 'set'}: ${clean.length} named`, { details: { before: settings.approverAccountIds, after: clean } });
  return getSettings();
});

/** Break-glass: a non-approver admin asks to reset to small-team mode. Takes effect in 72 hours unless an approver cancels. */
export const requestReset = locked(async (actor, reason) => {
  if (String(reason || '').trim().length < 10) throw new PreflightError('Give a reason (at least 10 characters) for the reset.');
  const { settings, named } = await mode();
  if (!named) throw new PreflightError('No approvers are named, so there is nothing to reset.');
  if (isApprover(settings, actor)) throw new PreflightError('You are an approver: change the approver list directly instead.');
  if (settings.pendingReset) throw new PreflightError('A reset is already pending.');
  const pendingReset = { by: actor, at: now(), effectiveAt: now() + RESET_DELAY_MS, reason: redact(String(reason)).slice(0, 300) };
  await saveSettings({ pendingReset });
  await audit(actor, 'approvers.reset.requested', `Requested reset to small-team mode (takes effect in 72 hours unless an approver cancels): ${pendingReset.reason}`);
  return getSettings();
});

export const cancelReset = locked(async (actor) => {
  const { settings } = await mode();
  if (!isApprover(settings, actor)) throw new PreflightError('Only an approver can cancel a reset.');
  if (!settings.pendingReset) throw new PreflightError('No reset is pending.');
  await saveSettings({ pendingReset: null });
  await audit(actor, 'approvers.reset.cancelled', 'Cancelled the pending reset to small-team mode');
  return getSettings();
});

/* ---------------- policy settings ---------------- */

/** Strengthening is open to admins; weakening a control needs an approver in named mode. */
export const setPolicy = locked(async (patch, actor) => {
  const { settings, named } = await mode();
  const next = {};
  for (const key of ['failClosed', 'separationOfDuties', 'requireDeclaration']) if (typeof patch[key] === 'boolean' && patch[key] !== settings[key]) next[key] = patch[key];
  if (!Object.keys(next).length) return settings;
  const weakening = Object.entries(next).some(([, v]) => v === false);
  if (weakening && named && !isApprover(settings, actor)) throw new PreflightError('Only a named approver can weaken a control.');
  if (!named && !(await currentUserIsJiraAdmin())) throw new PreflightError('Only a Jira admin can change settings in small-team mode.');
  await saveSettings(next);
  await audit(actor, 'settings.changed', `Settings: ${Object.entries(next).map(([k, v]) => `${k} → ${v}`).join(', ')}`, { details: { before: settings } });
  return getSettings();
});

export const adminAudit = (limit = 50) => listAudit('admin', { limit });

/** Save a DRAFT rule proposed by the Rovo agent from a policy page. Admins only; drafts are never enforced. */
export const draftRuleFromPolicy = locked(async (input, actor) => {
  if (!(await currentUserIsJiraAdmin())) throw new PreflightError('Only Jira administrators can add Preflight rules.');
  const rules = await getRules();
  let id = String(input.ruleId || input.title || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50);
  if (id.length < 3) id = `rule-${now().toString(36)}`;
  while (rules.some((r) => r.id === id)) id = `${id.slice(0, 45)}-${Math.random().toString(36).slice(2, 5)}`;
  const rule = { ...cleanRule({ ...input, id }, null), status: 'draft', source: { kind: 'rovo-draft', url: input.sourceUrl || null, by: actor, at: now() } };
  await saveRules([...rules, rule]);
  await appendAudit('admin', { by: actor, via: 'agent', action: 'rule.drafted', ruleId: rule.id, event: `Rovo drafted rule "${rule.title}" from ${input.sourceUrl || 'a policy'} (draft, not enforced)` });
  return rule;
});

/** Bulk pack operations: in named mode only an approver may run them (they bypass per-rule proposals). */
export async function requireApproverForBulk(actor) {
  const { settings, named } = await mode();
  if (named && !isApprover(settings, actor)) throw new PreflightError('Approvers are named, so only an approver can reload or reset the rule pack.');
}

/** Replace the starter pack's rules, keeping custom rules and keeping versions of unchanged rules. */
export const replacePack = locked(async (packRules, packPrefix, status, actor) => {
  const current = await getRules();
  const t = now();
  const byId = new Map(current.map((r) => [r.id, r]));
  const next = packRules.map((r) => {
    const old = byId.get(r.id);
    const same = old && substantive(old) === substantive({ ...old, ...r });
    return { ...r, status, pack: packPrefix, updatedAt: same ? old.updatedAt : t, activatedBy: status === 'active' ? actor : null, activatedAt: status === 'active' ? t : null, pending: null };
  });
  const custom = current.filter((r) => !String(r.pack || '').startsWith('popia-starter'));
  await saveRules([...next, ...custom]);
  return next;
});
