/**
 * Preflight service layer: every read and write goes through here.
 *
 * Governance rules enforced on the server:
 *   - AI never approves, dismisses, grants exceptions or activates rules.
 *   - Rovo can only PROPOSE answers. A proposal does not count until a person
 *     confirms it in the issue panel (saveAnswers is panel-only).
 *   - Once approvers are named, only they can approve; a Jira admin is not
 *     automatically the Information Officer. Small-team mode (no named
 *     approvers) lets Jira admins approve and is labelled as such.
 *   - Every change writes a write-once audit event.
 */
import { evaluate, answersFingerprint, redact, stageOf } from './engine/evaluate.js';
import {
  getRules, getSettings, getRecord, updateRecord, appendAudit, setQueueEntry, deleteRecord,
} from './store.js';
import { getWorkItem, currentUserIsJiraAdmin, setPreflightProperty, getPreflightProperty, addComment } from './jira.js';
import { PreflightError } from './errors.js';
import { kvs } from '@forge/kvs';
import { DECLARATION_RULE_ID } from './rulepacks/popia.js';
import { coolingDown } from './governance.js';

export { PreflightError };

const APPROVAL_REQUEST_COOLDOWN_MS = 10 * 60 * 1000;

export function evalOptions(rules, settings) {
  return {
    // The rule a Yes/Unsure declaration raises: the active pack's broadest rule (POPIA or GDPR personal information).
    declarationRuleId: (rules.find((r) => r.status === 'active' && (r.declaration || r.id === DECLARATION_RULE_ID)) || {}).id || null,
    requireDeclaration: Boolean(settings.requireDeclaration),
  };
}

/** Load work item, rules, settings and evidence, and run the engine. */
/**
 * @param extraText  earlier wording of the work item (from a trigger's changelog
 *                   or creation payload). Used ONLY to remember rules that matched,
 *                   so a ticket reworded seconds after it was created is still caught.
 * @param persist    true: save new sticky matches (errors propagate, except a busy lock).
 *                   'best-effort': save them but never fail the caller (used by the gates).
 */
export async function assess(issueIdOrKey, { asUser = true, persist = true, extraText = '' } = {}) {
  const workItem = await getWorkItem(issueIdOrKey, { asUser });
  const [rules, settings, record] = await Promise.all([getRules(), getSettings(), getRecord(workItem.id)]);
  const opts = evalOptions(rules, settings);
  let result = evaluate(workItem, rules, record, opts);
  // Earlier wording is matched on its own (never joined to the live text, so the two cannot combine into a match neither made).
  const earlier = extraText ? evaluate({ ...workItem, text: extraText, labels: [] }, rules, {}, opts).applicable : [];

  // Remember every rule AND every phrase that matched, so rewording cannot remove them or narrow an approval's scope.
  const found = new Map();
  for (const m of [...result.applicable, ...earlier]) {
    const phrases = [...m.why.keywords, ...m.why.labels];
    if (!phrases.length) continue;
    const prev = found.get(m.ruleId);
    found.set(m.ruleId, { ...m, phrases: [...new Set([...(prev?.phrases || []), ...phrases])] });
  }
  const newlyMatched = [...found.values()]
    .map((m) => ({ ...m, phrases: m.phrases.filter((p) => !(record.matched?.[m.ruleId]?.phrases || []).includes(p)) }))
    .filter((m) => m.phrases.length);
  if (newlyMatched.length && persist) {
    try {
      const saved = await updateRecord(
        workItem.id,
        'app',
        `Matched ${newlyMatched.map((m) => `"${m.title}" (${m.phrases.join(', ')})`).join('; ')}`,
        (rec) => {
          rec.matched = rec.matched || {};
          for (const m of newlyMatched) {
            const prev = rec.matched[m.ruleId];
            rec.matched[m.ruleId] = prev
              ? { ...prev, phrases: [...new Set([...(prev.phrases || []), ...m.phrases])] }
              : { at: Date.now(), phrases: m.phrases, ruleVersion: m.ruleVersion };
          }
        },
        { via: 'engine', ruleIds: newlyMatched.map((m) => m.ruleId) },
      );
      result = evaluate(workItem, rules, saved, opts);
      return { workItem, rules, settings, record: saved, result };
    } catch (error) {
      // Busy lock: the live text still matches, so the evaluation is correct; persist next time.
      if (error.code !== 'BUSY' && persist !== 'best-effort') throw error;
      if (persist === 'best-effort' && error.code !== 'BUSY') console.warn('Preflight could not save sticky matches', error.message);
    }
  }
  return { workItem, rules, settings, record, result };
}

/** Keep the JQL mirror and the approvals inbox in step. Neither is ever used for enforcement. */
export async function syncIndexes(workItem, result, record = null) {
  const next = {
    status: result.status,
    build: result.stages.build.status,
    open: result.openCount,
    awaiting: result.awaitingApproval ? 'yes' : 'no',
    rules: result.applicable.map((m) => m.ruleId),
  };
  const current = await getPreflightProperty(workItem.id).catch(() => null);
  const changed =
    !current || current.status !== next.status || current.build !== next.build || current.open !== next.open ||
    current.awaiting !== next.awaiting || current.rules?.join() !== next.rules.join();
  if (changed) await setPreflightProperty(workItem.id, { ...next, evaluatedAt: Date.now() });

  const reviewOpen = ['blocked', 'exception'].includes(result.status) || result.stages.build.status === 'blocked' ||
    Boolean(record?.bypass && !record.bypass.resolvedAt);
  await setQueueEntry(
    workItem.id,
    reviewOpen
      ? {
          issueId: workItem.id,
          key: workItem.key,
          summary: redact(workItem.summary).slice(0, 200),
          projectKey: workItem.projectKey,
          awaitingApproval: result.awaitingApproval && result.status !== 'exception',
          exception: result.status === 'exception' ? { expiresAt: record?.exception?.expiresAt || null } : null,
          bypassed: record?.bypass && !record.bypass.resolvedAt ? { stage: record.bypass.stage, status: record.bypass.status, at: record.bypass.at } : null,
          buildStatus: result.stages.build.status,
          openBuild: result.stages.build.open.length,
          openTotal: result.openCount,
          rules: result.applicable.map((m) => m.title),
          updatedAt: Date.now(),
        }
      : null,
  );
  return changed;
}

/** Simple sliding-window counter in KVS (used to stop agents spamming approval requests). */
async function rateLimit(key, max, windowMs, message) {
  const now = Date.now();
  const hits = ((await kvs.get(key)) || []).filter((t) => t > now - windowMs);
  if (hits.length >= max) throw new PreflightError(message);
  await kvs.set(key, [...hits, now], { ttl: { value: Math.ceil(windowMs / 1000), unit: 'SECONDS' } });
}

/* ---------------- who may approve ---------------- */

export async function approverMode() {
  const settings = await getSettings();
  return settings.approverAccountIds.length ? 'named-approvers' : 'small-team';
}

/** Only valid for the signed-in user (uses their Jira permissions). */
export async function canCurrentUserApprove(accountId) {
  const settings = await getSettings();
  if (settings.approverAccountIds.length) return settings.approverAccountIds.includes(accountId);
  if (coolingDown(settings, accountId)) return false; // the admin who forced a reset cannot approve for 30 days
  return currentUserIsJiraAdmin();
}

/** Why the signed-in user cannot approve this rule on this work item (separation of duties), or null. */
export function separationReason(settings, workItem, record, ruleId, accountId) {
  if (!settings.separationOfDuties) return null;
  if (workItem?.reporterAccountId === accountId) return 'you reported this work item';
  if (workItem?.assigneeAccountId === accountId) return 'you are assigned to this work item';
  const authors = Object.values(record?.answers?.[ruleId] || {}).map((a) => a.by);
  if (authors.includes(accountId)) return 'you answered these questions';
  return null;
}

async function requireApprover(accountId, workItem, record = null, ruleId = null, { separation = true } = {}) {
  if (!(await canCurrentUserApprove(accountId))) {
    const mode = await approverMode();
    throw new PreflightError(
      mode === 'named-approvers' ? 'Only a named Preflight approver can do this.' : 'Only a Jira admin can do this in small-team mode.',
    );
  }
  if (!separation) return;
  const settings = await getSettings();
  const reason = separationReason(settings, workItem, record, ruleId, accountId);
  if (reason) throw new PreflightError(`Separation of duties is on and ${reason}, so another approver must do this.`);
}

function findApplicable(result, ruleId) {
  const match = result.applicable.find((m) => m.ruleId === ruleId);
  if (!match) throw new PreflightError(`Rule ${ruleId} does not apply to this work item.`);
  return match;
}

/* ---------------- answers ---------------- */

/** Save answers a PERSON typed or confirmed in the panel. The only way a requirement becomes satisfied. */
export async function saveAnswers(issueIdOrKey, ruleId, answers, actor) {
  const { workItem, rules, result, record } = await assess(issueIdOrKey);
  findApplicable(result, ruleId);
  const rule = rules.find((r) => r.id === ruleId);
  const allowed = new Map(rule.requirements.filter((r) => r.type !== 'approval').map((r) => [r.id, r]));
  const clean = {};
  const answered = [];
  const cleared = [];
  for (const [reqId, value] of Object.entries(answers || {})) {
    if (!allowed.has(reqId)) throw new PreflightError(`Unknown requirement "${reqId}" for ${rule.title}.`);
    const text = String(value ?? '').slice(0, 2000);
    const before = String(record?.answers?.[ruleId]?.[reqId]?.value ?? '');
    // Only real changes are saved and logged: an empty box that was already empty is not an answer.
    if (text.trim() === before.trim()) continue;
    clean[reqId] = { value: text, by: actor, at: Date.now() };
    (text.trim() ? answered : cleared).push(allowed.get(reqId).label);
  }
  if (!Object.keys(clean).length) throw new PreflightError('Nothing has changed since the last save.');
  await updateRecord(
    workItem.id,
    actor,
    [answered.length && `Answered ${answered.join(', ')}`, cleared.length && `Cleared ${cleared.join(', ')}`].filter(Boolean).join('; ') + ` for "${rule.title}"`,
    (rec) => {
      rec.answers[ruleId] = { ...(rec.answers[ruleId] || {}), ...clean };
      for (const reqId of Object.keys(clean)) if (rec.drafts?.[ruleId]) delete rec.drafts[ruleId][reqId];
    },
    { ruleId, requirementIds: Object.keys(clean), ruleVersion: rule.updatedAt || null },
  );
  return refresh(workItem.id);
}

/**
 * Rovo PROPOSES an answer. It is stored as a draft and shown in the panel with
 * "Use draft" / "Discard". It never satisfies a requirement by itself.
 */
export async function proposeAnswer(issueIdOrKey, ruleId, requirementId, value, actor) {
  const { workItem, rules, result } = await assess(issueIdOrKey);
  findApplicable(result, ruleId);
  const rule = rules.find((r) => r.id === ruleId);
  const req = rule.requirements.find((r) => r.id === requirementId);
  if (!req) throw new PreflightError(`Unknown requirement "${requirementId}".`);
  if (req.type === 'approval') throw new PreflightError('Approvals cannot be drafted. Only a human approver can approve.');
  const text = String(value ?? '').trim().slice(0, 2000);
  if (!text) throw new PreflightError('The proposed answer is empty.');
  if (req.type === 'choice' && !req.options.includes(text)) {
    throw new PreflightError(`For "${req.label}" the answer must be exactly one of: ${req.options.join(' | ')}`);
  }
  await updateRecord(
    workItem.id,
    actor,
    `Rovo proposed an answer for ${req.label} ("${rule.title}"); waiting for a person to confirm`,
    (rec) => {
      rec.drafts = rec.drafts || {};
      rec.drafts[ruleId] = { ...(rec.drafts[ruleId] || {}), [requirementId]: { value: text, for: actor, at: Date.now() } };
    },
    { via: 'agent', ruleId, requirementIds: [requirementId] },
  );
  return refresh(workItem.id);
}

export async function discardDraft(issueIdOrKey, ruleId, requirementId, actor) {
  const { workItem } = await assess(issueIdOrKey);
  await updateRecord(workItem.id, actor, `Discarded a Rovo draft for ${requirementId}`, (rec) => {
    if (rec.drafts?.[ruleId]) delete rec.drafts[ruleId][requirementId];
  }, { ruleId, requirementIds: [requirementId] });
  return refresh(workItem.id);
}

/** Yes / No / Unsure: does this change affect personal information? */
export async function declare(issueIdOrKey, value, actor, via = 'panel') {
  if (!['yes', 'no', 'unsure'].includes(value)) throw new PreflightError('Choose Yes, No or Unsure.');
  const { workItem, record } = await assess(issueIdOrKey);
  const RANK = { no: 0, unsure: 1, yes: 2 };
  const current = record.declaration?.value || null;
  // Everyone who has ever said this work affects (or may affect) personal information.
  const raisedBy = new Set(record.declaration?.raisedBy || (current && current !== 'no' ? [record.declaration.by] : []));
  const downgrade = current && RANK[value] < RANK[current];
  if (downgrade && [...raisedBy].some((id) => id !== actor)) {
    // Someone else raised this; only an approver can lower it, in one step or several.
    await requireApprover(actor, workItem);
  }
  if (value !== 'no') raisedBy.add(actor);
  await updateRecord(workItem.id, actor, `Declared personal information impact: ${value}${current ? ` (was ${current})` : ''}`, (rec) => {
    rec.declaration = { value, by: actor, at: Date.now(), via, raisedBy: [...raisedBy] };
  }, { via });
  return refresh(workItem.id);
}

/* ---------------- approver actions ---------------- */

export async function approve(issueIdOrKey, ruleId, actor, note = '') {
  const { workItem, record, rules, result } = await assess(issueIdOrKey);
  await requireApprover(actor, workItem, record, ruleId);
  const match = findApplicable(result, ruleId);
  const unanswered = match.requirements.filter((r) => r.type !== 'approval' && r.stage === 'build' && !r.satisfied);
  if (unanswered.length) throw new PreflightError(`Answer these first: ${unanswered.map((r) => r.label).join(', ')}.`);
  const rule = rules.find((r) => r.id === ruleId);
  if (!rule.requirements.some((r) => r.type === 'approval')) throw new PreflightError('This rule does not need approval.');
  const fingerprint = answersFingerprint(record.answers[ruleId] || {}, rule);
  await updateRecord(
    workItem.id,
    actor,
    `Approved "${match.title}" (covers: ${match.scope.join(', ') || 'flagged'})${note ? `: ${redact(note)}` : ''}`,
    (rec) => {
      rec.approvals[ruleId] = {
        by: actor, at: Date.now(), fingerprint, ruleVersion: rule.updatedAt || null, scope: match.scope, note: redact(String(note)).slice(0, 500),
      };
    },
    { ruleId, ruleVersion: rule.updatedAt || null },
  );
  return refresh(workItem.id);
}

export async function revokeApproval(issueIdOrKey, ruleId, actor) {
  const { workItem } = await assess(issueIdOrKey);
  await requireApprover(actor, workItem, null, null, { separation: false }); // revoking only adds review
  await updateRecord(workItem.id, actor, `Revoked approval for ${ruleId}`, (rec) => {
    delete rec.approvals[ruleId];
  }, { ruleId });
  return refresh(workItem.id);
}

/** Anyone can flag a rule the matcher missed. Only an approver can remove one (dismiss). */
export async function flagRule(issueIdOrKey, ruleId, actor, via = 'panel') {
  const { workItem, rules } = await assess(issueIdOrKey);
  const rule = rules.find((r) => r.id === ruleId && r.status === 'active');
  if (!rule) throw new PreflightError('That rule is not active.');
  await updateRecord(workItem.id, actor, `Flagged "${rule.title}" as applying`, (rec) => {
    rec.manual = [...new Set([...(rec.manual || []), ruleId])];
    delete rec.dismissals[ruleId];
  }, { via, ruleId });
  return refresh(workItem.id);
}

/** Approver: this rule does not apply to this work item (false positive). Needs a reason. */
export async function dismissRule(issueIdOrKey, ruleId, actor, reason) {
  if (String(reason || '').trim().length < 10) throw new PreflightError('Give a reason (at least 10 characters) for dismissing the rule.');
  const { workItem, result } = await assess(issueIdOrKey);
  await requireApprover(actor, workItem);
  const match = findApplicable(result, ruleId);
  await updateRecord(workItem.id, actor, `Dismissed "${match.title}" for "${match.scope.join('", "')}": ${redact(reason)}`, (rec) => {
    rec.dismissals[ruleId] = { by: actor, at: Date.now(), reason: redact(String(reason)).slice(0, 500), phrases: match.scope };
    rec.manual = (rec.manual || []).filter((id) => id !== ruleId);
  }, { ruleId });
  return refresh(workItem.id);
}

export async function restoreRule(issueIdOrKey, ruleId, actor) {
  const { workItem } = await assess(issueIdOrKey);
  await requireApprover(actor, workItem, null, null, { separation: false });
  await updateRecord(workItem.id, actor, `Restored ${ruleId}`, (rec) => {
    delete rec.dismissals[ruleId];
  }, { ruleId });
  return refresh(workItem.id);
}

/** Exception: the rules apply, but an approver accepts a deviation for a limited time. */
export async function setException(issueIdOrKey, actor, reason, days = 30) {
  if (String(reason || '').trim().length < 10) throw new PreflightError('Give a reason (at least 10 characters) for the exception.');
  const validDays = Math.min(90, Math.max(1, Math.round(Number(days) || 30)));
  const { workItem, result } = await assess(issueIdOrKey);
  await requireApprover(actor, workItem);
  // Scope: only the rules that are open right now. Rules that match later are not waived.
  const ruleIds = [...new Set(result.open.map((o) => o.ruleId))];
  if (!ruleIds.length) throw new PreflightError('Nothing is open, so there is nothing to grant an exception for.');
  const titles = result.applicable.filter((m) => ruleIds.includes(m.ruleId)).map((m) => m.title);
  // Also pin the phrases each waived rule matched; if the work item later mentions more, the waiver no longer covers it.
  const scopes = Object.fromEntries(result.applicable.filter((m) => ruleIds.includes(m.ruleId)).map((m) => [m.ruleId, m.scope]));
  const expiresAt = Date.now() + validDays * 24 * 60 * 60 * 1000;
  await updateRecord(workItem.id, actor, `Exception granted for ${validDays} day(s) covering ${titles.join(', ')}: ${redact(reason)}`, (rec) => {
    rec.exception = { by: actor, at: Date.now(), reason: redact(String(reason)).slice(0, 500), expiresAt, ruleIds, scopes };
  });
  return refresh(workItem.id);
}

export async function clearException(issueIdOrKey, actor) {
  const { workItem } = await assess(issueIdOrKey);
  await requireApprover(actor, workItem, null, null, { separation: false });
  await updateRecord(workItem.id, actor, 'Exception withdrawn', (rec) => {
    rec.exception = null;
  });
  return refresh(workItem.id);
}

/** Comment that @mentions the approvers with what is waiting on them. Rate-limited per work item. */
export async function requestApproval(issueIdOrKey, actor, message = '', via = 'panel') {
  const { workItem, result, record } = await assess(issueIdOrKey);
  if (result.status !== 'blocked' && result.stages.build.status !== 'blocked') {
    return { posted: false, reason: `Nothing to approve: ${result.summary}` };
  }
  const since = Date.now() - (record.lastApprovalRequestAt || 0);
  if (since < APPROVAL_REQUEST_COOLDOWN_MS) {
    return { posted: false, reason: `Approval was already requested ${Math.round(since / 60000)} minute(s) ago. Try again later.` };
  }
  if (via !== 'panel') await rateLimit(`rl:approval:${actor}`, 10, 60 * 60 * 1000, 'You have requested a lot of approvals in the last hour. Try again later.');
  const settings = await getSettings();
  const mentions = settings.approverAccountIds.filter((id) => id !== 'closed-account').slice(0, 5).flatMap((id) => [{ type: 'mention', attrs: { id } }, { type: 'text', text: ' ' }]);
  const lines = result.open.map((o) => `• ${o.ruleTitle} (${o.ruleClause}): ${o.label}, ${o.reason.toLowerCase()}`);
  const body = {
    type: 'doc',
    version: 1,
    content: [
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: 'Preflight review requested ', marks: [{ type: 'strong' }] },
          ...(mentions.length ? mentions : [{ type: 'text', text: '(small-team mode: any Jira admin can approve) ' }]),
        ],
      },
      ...(message ? [{ type: 'paragraph', content: [{ type: 'text', text: redact(String(message)).slice(0, 1000) }] }] : []),
      ...lines.map((line) => ({ type: 'paragraph', content: [{ type: 'text', text: line }] })),
    ],
  };
  await addComment(workItem.key, body);
  await updateRecord(workItem.id, actor, 'Requested approval', (rec) => {
    rec.lastApprovalRequestAt = Date.now();
  }, { via });
  return { posted: true, notified: settings.approverAccountIds.length, open: result.openCount };
}

export { draftRuleFromPolicy } from './governance.js';

/* ---------------- bypass detection ---------------- */

/**
 * A work item whose status is past a gate while that gate's stage is still open
 * skipped the gate (moved to another project, changed work type, or a workflow
 * without the validator) or its review went stale after it passed. Either way an
 * approver should look. Records it once, comments to the approvers, and puts it
 * in the inbox until the review is complete again.
 */
export async function checkBypass({ workItem, result, record }) {
  const category = workItem.statusCategory;
  let stage = null;
  // Only open requirements of a matched rule count. A missing Yes/No/Unsure declaration on unrelated work is not a bypass.
  const openIn = (s) => s.status === 'blocked' && s.open.length > 0;
  if (category === 'done' && openIn(result.stages.done)) stage = 'done';
  else if ((category === 'indeterminate' || category === 'done') && openIn(result.stages.build)) stage = 'build';
  const open = record.bypass && !record.bypass.resolvedAt;
  if (!stage) {
    if (!open) return record;
    return updateRecord(workItem.id, 'app', 'Back in step: the privacy review is complete for the current status', (rec) => {
      rec.bypass = { ...rec.bypass, resolvedAt: Date.now() };
    }, { via: 'engine' });
  }
  if (open && record.bypass.stage === stage) return record;
  const what = stage === 'build' ? 'review before build' : 'evidence before Done';
  const event = `${workItem.key} is in "${workItem.status}" but its ${what} is still open: a gate was skipped (moved from another space, changed work type or a workflow without the validator) or the review went stale after the gate`;
  const saved = await updateRecord(workItem.id, 'app', event, (rec) => {
    rec.bypass = { stage, status: workItem.status, at: Date.now(), resolvedAt: null };
  }, { via: 'engine' });
  await appendAudit('admin', { by: 'app', via: 'engine', action: 'gate.bypassed', event, issueKey: workItem.key }).catch(() => {});
  try {
    const settings = await getSettings();
    const mentions = settings.approverAccountIds.filter((id) => id !== 'closed-account').slice(0, 5).flatMap((id) => [{ type: 'mention', attrs: { id } }, { type: 'text', text: ' ' }]);
    await addComment(workItem.key, {
      type: 'doc',
      version: 1,
      content: [{
        type: 'paragraph',
        content: [
          { type: 'text', text: 'Preflight: ', marks: [{ type: 'strong' }] },
          ...mentions,
          { type: 'text', text: `this work item is in "${workItem.status}" but its privacy ${what} is not complete. Open the Preflight panel to finish it, and check the workflow has the Preflight gate.` },
        ],
      }],
    }, { asApp: true });
  } catch (error) {
    console.warn('Preflight bypass comment failed', error.message);
  }
  return saved;
}

/* ---------------- lifecycle ---------------- */

/** When a work item is deleted, delete its evidence (POPIA s14 spirit). The audit history is kept. */
export async function onIssueDeleted(issueId, issueKey) {
  await deleteRecord(issueId);
  await appendAudit(issueId, { by: 'app', via: 'engine', event: `Work item ${issueKey || issueId} deleted; Preflight evidence removed` });
}

/** Re-evaluate after a change and update the mirrors. */
async function refresh(issueId) {
  const state = await assess(issueId);
  try {
    await syncIndexes(state.workItem, state.result, state.record);
  } catch (error) {
    console.warn('Preflight index sync failed', error.message);
  }
  return state;
}

export { stageOf };
