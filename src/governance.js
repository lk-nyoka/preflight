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
 *       (for when the Information Officer has left). A second Jira admin must
 *       confirm it, it takes effect 72 hours after the request, any approver can
 *       cancel it, and for 30 days afterwards the requester cannot approve work,
 *       weaken a control or name the new approvers.
 *
 * Every change, proposal and decision is written to the write-once admin audit log.
 * All mutations run under one lock, so concurrent admin and approver actions
 * cannot lose each other's updates.
 */
import { getRules, saveRules, getSettings, saveSettings, appendAudit, listAudit, withLock } from './store.js';
import { cleanRule } from './rules.js';
import { PreflightError } from './errors.js';
import { currentUserIsJiraAdmin } from './jira.js';
import { redact, matchTriggers } from './engine/evaluate.js';

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
// Key order and editor defaults must not count as a change: compare canonical JSON of the cleaned form.
const canon = (v) => (Array.isArray(v) ? v.map(canon) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k])])) : v);
const substantive = (r) => JSON.stringify(canon({ t: r.title, c: r.clause, s: r.summary, tr: r.triggers, rq: r.requirements, sev: r.severity }));

/**
 * Field-complete diff an approver can judge. Every trigger and requirement field
 * is compared, and anything that could make the rule match less or ask for less
 * is listed under `weakening`. The rule's own "must match" examples and the
 * phrases it matched before are re-run against the proposed version, so an
 * approver sees "N examples that matched now don't" even for a subtle change.
 */
export function diff(before, after) {
  if (!before) return { summary: 'new rule', weakening: [], weakens: false, before: null, after: snapshot(after) };
  const t = (r) => r.triggers || {};
  const set = (xs) => new Set((xs || []).map((x) => String(x).toLowerCase()));
  const added = (a, b) => [...set(b)].filter((x) => !set(a).has(x));
  const removed = (a, b) => added(b, a);
  const groups = (r) => new Map((t(r).contextual || []).map((g) => [[...set(g.terms)].sort().join('|'), g]));
  const reqs = (r) => new Map((r.requirements || []).map((q) => [q.id, q]));
  const describeReq = (q) => `${q.label} [${q.type}, ${q.type === 'approval' ? 'build' : q.stage || 'build'}]`;

  const changes = [];
  const weakening = [];
  const note = (text, weak = false) => { changes.push(text); if (weak) weakening.push(text); };

  for (const k of added(t(before).keywords, t(after).keywords)) note(`+ phrase "${k}"`);
  for (const k of removed(t(before).keywords, t(after).keywords)) note(`− phrase "${k}"`, true);
  for (const k of added(t(before).exclude, t(after).exclude)) note(`+ excluded phrase "${k}" (text containing it is ignored)`, true);
  for (const k of removed(t(before).exclude, t(after).exclude)) note(`− excluded phrase "${k}"`);
  for (const k of added(t(before).labels, t(after).labels)) note(`+ label "${k}"`);
  for (const k of removed(t(before).labels, t(after).labels)) note(`− label "${k}"`, true);

  const [gb, ga] = [groups(before), groups(after)];
  for (const [key, g] of ga) {
    const old = gb.get(key);
    if (!old) { note(`+ context group "${g.terms.join(', ')}" with "${g.with.join(', ')}"`); continue; }
    for (const w of added(old.with, g.with)) note(`context "${g.terms.join(', ')}": + required word "${w}"`, (old.with || []).length === 0);
    for (const w of removed(old.with, g.with)) note(`context "${g.terms.join(', ')}": − required word "${w}"`, true);
  }
  for (const [key, g] of gb) if (!ga.has(key)) note(`− context group "${g.terms.join(', ')}"`, true);

  const [rb, ra] = [reqs(before), reqs(after)];
  for (const [id, q] of ra) {
    const old = rb.get(id);
    if (!old) { note(`+ requirement ${describeReq(q)}`); continue; }
    if (old.type !== q.type) note(`requirement "${old.label}": type ${old.type} → ${q.type}`, true);
    if ((old.stage || 'build') !== (q.stage || 'build') && q.type !== 'approval') note(`requirement "${old.label}": stage ${old.stage || 'build'} → ${q.stage || 'build'}`, q.stage === 'done');
    if (old.label !== q.label) note(`requirement label "${old.label}" → "${q.label}"`);
    if ((old.help || '') !== (q.help || '')) note(`requirement "${q.label}": help text changed`);
    for (const o of added(old.options, q.options)) note(`requirement "${q.label}": + option "${o}"`, true);
    for (const o of removed(old.options, q.options)) note(`requirement "${q.label}": − option "${o}"`);
    const [mb, ma] = [old.minWords ?? 4, q.minWords ?? 4];
    if (mb !== ma) note(`requirement "${q.label}": minimum words ${mb} → ${ma}`, ma < mb);
    for (const w of added(old.mustMention, q.mustMention)) note(`requirement "${q.label}": answers may now mention "${w}" instead`, true);
    for (const w of removed(old.mustMention, q.mustMention)) note(`requirement "${q.label}": answers can no longer rely on "${w}"`, (q.mustMention || []).length === 0);
  }
  for (const [id, q] of rb) if (!ra.has(id)) note(`− requirement ${describeReq(q)}`, true);

  for (const f of ['title', 'clause', 'summary', 'policyRef']) if ((before[f] || '') !== (after[f] || '')) note(`${f} changed`);
  const rank = { low: 0, medium: 1, high: 2 };
  if ((before.severity || 'high') !== (after.severity || 'high')) note(`severity ${before.severity || 'high'} → ${after.severity || 'high'}`, rank[after.severity] < rank[before.severity]);

  // Behavioural check: re-run what the current version matches against the proposed version.
  const probes = [...new Set([...(before.examples?.match || []), ...(after.examples?.match || [])])];
  const lostExamples = probes.filter((x) => matchTriggers(x, before.triggers).keywords.length && !matchTriggers(x, after.triggers).keywords.length);
  for (const x of lostExamples) note(`example no longer matches: "${x}"`, true);
  const newlyCaught = probes.filter((x) => !matchTriggers(x, before.triggers).keywords.length && matchTriggers(x, after.triggers).keywords.length);

  const summary = changes.length
    ? `${changes.length} change(s)${weakening.length ? `, ${weakening.length} that make the rule match less or ask for less` : ''}`
    : 'no effective change';
  return {
    summary, changes, weakening, weakens: weakening.length > 0, lostExamples, newlyCaught,
    before: snapshot(before), after: snapshot(after),
  };
}

/** What an approver needs to see of a rule, without bookkeeping fields. */
export function snapshot(r) {
  if (!r) return null;
  return {
    id: r.id, title: r.title, clause: r.clause, summary: r.summary, severity: r.severity || 'high',
    triggers: r.triggers, requirements: r.requirements, examples: r.examples || null,
  };
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
  if (existing && (substantive(existing) === substantive(cleaned) || substantive(cleanRule(existing, existing)) === substantive(cleaned))) cleaned = { ...cleaned, updatedAt: existing.updatedAt };
  const { settings, named } = await mode();
  const change = diff(existing, cleaned);
  if (existing?.status === 'active' && !named && change.weakens && coolingDown(settings, actor)) {
    throw new PreflightError('You requested the approver reset, so for 30 days you cannot weaken an active rule. Ask another Jira admin.');
  }

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
  if (!named && target === 'draft' && coolingDown(settings, actor)) {
    throw new PreflightError('You requested the approver reset, so for 30 days you cannot deactivate an active rule. Ask another Jira admin.');
  }
  if (named && !isApprover(settings, actor)) {
    if (rule.pending) throw new PreflightError('A change to this rule is already waiting for an approver.');
    const kind = target === 'active' ? 'activate' : 'deactivate';
    rule.pending = { id: newId(), kind, by: actor, at: now(), reason: redact(String(reason)).slice(0, 300), snapshot: snapshot(rule) };
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
    rule: r.pending.snapshot || r.pending.diff?.after || snapshot(r),
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
    if (kind === 'edit') {
      const applied = rule.pending.rule;
      // The version is the moment the change takes effect, so approvals given while it was pending go stale.
      const version = substantive(rule) === substantive(applied) ? rule.updatedAt : now();
      rules[index] = { ...applied, updatedAt: version, status: rule.status, activatedBy: rule.activatedBy, activatedAt: rule.activatedAt, pending: null };
    }
    else { applyStatus(rule, kind === 'activate' ? 'active' : 'draft', actor); rule.pending = null; }
  } else {
    rule.pending = null;
  }
  await saveRules(rules);
  await audit(actor, `rule.${kind}.${decision === 'apply' ? 'applied' : 'rejected'}`, `${decision === 'apply' ? 'Applied' : 'Rejected'} proposal to ${kind} "${rule.title}"`, { ruleId: id });
  return { rules };
});

/* ---------------- approvers and break-glass reset ---------------- */

const RESET_COOLDOWN_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * After a break-glass reset, the admin who asked for it cannot approve work or
 * weaken a control for 30 days. Otherwise a reset would simply hand that admin
 * full control.
 */
export function coolingDown(settings, actor) {
  return Boolean(settings.resetBy && settings.resetBy === actor && (settings.resetCooldownUntil || 0) > now());
}

/** Apply a reset once it is confirmed by a second Jira admin AND its 72-hour wait has passed. */
export const applyDueReset = locked(async () => {
  const settings = await getSettings();
  const r = settings.pendingReset;
  if (!r || !r.confirmedBy || r.effectiveAt > now()) return settings;
  await saveSettings({ approverAccountIds: [], pendingReset: null, resetBy: r.by, resetCooldownUntil: now() + RESET_COOLDOWN_MS });
  await audit(r.by, 'approvers.reset', `Reset to small-team mode took effect (requested ${new Date(r.at).toISOString()}, confirmed by a second admin): ${r.reason}`, { details: { before: settings.approverAccountIds, confirmedBy: r.confirmedBy } });
  return getSettings();
});

export const setApprovers = locked(async (list, actor) => {
  const clean = [...new Set((list || []).filter((id) => typeof id === 'string' && id))].slice(0, 20);
  const { settings, named } = await mode();
  if (named && !isApprover(settings, actor)) {
    throw new PreflightError('Only a current approver can change the approver list. If your approver has left, request a reset (a second Jira admin must confirm it, it takes 72 hours, and approvers can cancel it).');
  }
  if (named && !clean.length) throw new PreflightError('Keep at least one approver.');
  if (!named && !(await currentUserIsJiraAdmin())) throw new PreflightError('Only a Jira admin can name the first approvers.');
  if (!named && coolingDown(settings, actor)) {
    throw new PreflightError('You requested the reset, so another Jira admin must name the new approvers.');
  }
  await saveSettings({ approverAccountIds: clean, pendingReset: null, ...(named ? {} : { resetBy: null, resetCooldownUntil: null }) });
  await audit(actor, named ? 'approvers.changed' : 'approvers.set', `Approvers ${named ? 'changed' : 'set'}: ${clean.length} named`, { details: { before: settings.approverAccountIds, after: clean } });
  return getSettings();
});

/**
 * Break-glass: a non-approver admin asks to reset to small-team mode (for when
 * the Information Officer has left). A SECOND Jira admin must confirm it, it
 * takes effect 72 hours later, any approver can cancel it, and afterwards the
 * requester cannot approve, weaken a control or name the new approvers for 30 days.
 */
export const requestReset = locked(async (actor, reason) => {
  if (String(reason || '').trim().length < 10) throw new PreflightError('Give a reason (at least 10 characters) for the reset.');
  const { settings, named } = await mode();
  if (!named) throw new PreflightError('No approvers are named, so there is nothing to reset.');
  if (isApprover(settings, actor)) throw new PreflightError('You are an approver: change the approver list directly instead.');
  if (settings.pendingReset) throw new PreflightError('A reset is already pending.');
  const pendingReset = { by: actor, at: now(), effectiveAt: now() + RESET_DELAY_MS, reason: redact(String(reason)).slice(0, 300), confirmedBy: null };
  await saveSettings({ pendingReset });
  await audit(actor, 'approvers.reset.requested', `Requested reset to small-team mode (needs a second Jira admin to confirm; takes effect 72 hours after the request unless an approver cancels): ${pendingReset.reason}`);
  return getSettings();
});

export const confirmReset = locked(async (actor) => {
  const { settings } = await mode();
  const r = settings.pendingReset;
  if (!r) throw new PreflightError('No reset is pending.');
  if (r.by === actor) throw new PreflightError('A different Jira admin must confirm the reset.');
  if (isApprover(settings, actor)) throw new PreflightError('You are an approver: cancel the reset, or change the approver list directly.');
  if (r.confirmedBy) throw new PreflightError('The reset is already confirmed.');
  if (!(await currentUserIsJiraAdmin())) throw new PreflightError('Only a Jira admin can confirm a reset.');
  await saveSettings({ pendingReset: { ...r, confirmedBy: actor, confirmedAt: now() } });
  await audit(actor, 'approvers.reset.confirmed', 'Confirmed the pending reset to small-team mode');
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

/**
 * Small-team mode: Jira admins change settings (the admin who requested a reset
 * cannot weaken anything during the cooling-off period).
 * Named-approver mode: an approver can change anything; a Jira admin who is not
 * an approver can only strengthen. Nobody else can change settings at all.
 */
export const setPolicy = locked(async (patch, actor) => {
  const { settings, named } = await mode();
  const next = {};
  for (const key of ['failClosed', 'separationOfDuties', 'requireDeclaration']) if (typeof patch[key] === 'boolean' && patch[key] !== settings[key]) next[key] = patch[key];
  if (!Object.keys(next).length) return settings;
  const weakening = Object.entries(next).some(([, v]) => v === false);
  if (named) {
    if (!isApprover(settings, actor)) {
      if (weakening) throw new PreflightError('Only a named approver can weaken a control.');
      if (!(await currentUserIsJiraAdmin())) throw new PreflightError('Only a named approver or a Jira admin can change Preflight settings.');
    }
  } else {
    if (!(await currentUserIsJiraAdmin())) throw new PreflightError('Only a Jira admin can change settings in small-team mode.');
    if (weakening && coolingDown(settings, actor)) throw new PreflightError('You requested the approver reset, so for 30 days you cannot weaken a control. Ask another Jira admin.');
  }
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
  if (!named && coolingDown(settings, actor)) throw new PreflightError('You requested the approver reset, so for 30 days another Jira admin must do this.');
}

/**
 * Load a starter pack (POPIA, GDPR, ...). Other packs and custom rules are untouched.
 *   status "active" (Load demo): activates the pack's rules. Rules someone has
 *     edited keep their edits, and pending proposals are kept.
 *   status "draft" (Restore drafts): only allowed while none of the pack's rules
 *     is active, so a bulk action can never switch enforcement off in one click.
 *     Active rules are deactivated one by one, each with a reason in the audit log
 *     (a Jira admin who is not an approver can only propose it).
 * Every rule's before and after state goes to the audit log.
 */
export const replacePack = locked(async (pack, status, actor) => {
  const current = await getRules();
  const t = now();
  const byId = new Map(current.map((r) => [r.id, r]));
  const inPack = (r) => String(r.pack || '').startsWith(pack.prefix);
  if (status === 'draft') {
    const active = current.filter((r) => inPack(r) && r.status === 'active');
    if (active.length) {
      throw new PreflightError(`${active.length} ${pack.name} rule(s) are active. Deactivate them one by one first (each needs a reason), so enforcement is never switched off in bulk.`);
    }
  }
  const changes = [];
  const next = pack.rules.map((r) => {
    const old = byId.get(r.id);
    const edited = Boolean(old) && substantive(old) !== substantive({ ...old, ...r });
    const base = edited && status === 'active' ? old : { ...r, updatedAt: old && !edited ? old.updatedAt : t };
    const becameActive = status === 'active' && old?.status !== 'active';
    changes.push(`${r.id}: ${old ? `${old.status} → ${status}` : `new, ${status}`}${edited ? (status === 'active' ? ', kept local edits' : ', local edits replaced by the shipped version') : ''}`);
    return {
      ...base,
      status,
      pack: pack.id,
      activatedBy: status === 'active' ? (becameActive ? actor : old.activatedBy) : null,
      activatedAt: status === 'active' ? (becameActive ? t : old.activatedAt) : null,
      pending: old?.pending || null,
    };
  });
  const others = current.filter((r) => !inPack(r));
  await saveRules([...others, ...next]);
  await audit(actor, status === 'active' ? 'pack.activated' : 'pack.restored', `${status === 'active' ? 'Activated' : 'Restored as drafts'} the ${pack.name} starter pack (${next.length} rules)`, { details: { changes } });
  return next;
});
