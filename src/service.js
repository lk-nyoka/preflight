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

export { PreflightError };

const APPROVAL_REQUEST_COOLDOWN_MS = 10 * 60 * 1000;

export function evalOptions(rules, settings) {
  return {
    declarationRuleId: rules.some((r) => r.id === DECLARATION_RULE_ID && r.status === 'active') ? DECLARATION_RULE_ID : null,
    requireDeclaration: Boolean(settings.requireDeclaration),
  };
}

/** Load work item, rules, settings and evidence, and run the engine. */
export async function assess(issueIdOrKey, { asUser = true, persist = true } = {}) {
  const workItem = await getWorkItem(issueIdOrKey, { asUser });
  const [rules, settings, record] = await Promise.all([getRules(), getSettings(), getRecord(workItem.id)]);
  const opts = evalOptions(rules, settings);
  let result = evaluate(workItem, rules, record, opts);

  // Remember rules that matched by phrase or label so rewording cannot remove them.
  const newlyMatched = result.applicable.filter((m) => !record.matched?.[m.ruleId] && (m.why.keywords.length || m.why.labels.length));
  if (newlyMatched.length && persist) {
    try {
      const saved = await updateRecord(
        workItem.id,
        'app',
        `Matched ${newlyMatched.map((m) => `"${m.title}" (${[...m.why.keywords, ...m.why.labels].join(', ')})`).join('; ')}`,
        (rec) => {
          rec.matched = rec.matched || {};
          for (const m of newlyMatched) {
            rec.matched[m.ruleId] = { at: Date.now(), phrases: [...m.why.keywords, ...m.why.labels], ruleVersion: m.ruleVersion };
          }
        },
        { via: 'engine', ruleIds: newlyMatched.map((m) => m.ruleId) },
      );
      result = evaluate(workItem, rules, saved, opts);
      return { workItem, rules, settings, record: saved, result };
    } catch (error) {
      // Busy lock: the live text still matches, so the evaluation is correct; persist next time.
      if (error.code !== 'BUSY') throw error;
    }
  }
  return { workItem, rules, settings, record, result };
}

/** Keep the JQL mirror and the approvals inbox in step. Neither is ever used for enforcement. */
export async function syncIndexes(workItem, result) {
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

  const reviewOpen = ['blocked', 'exception'].includes(result.status) || result.stages.build.status === 'blocked';
  await setQueueEntry(
    workItem.id,
    reviewOpen
      ? {
          issueId: workItem.id,
          key: workItem.key,
          summary: redact(workItem.summary).slice(0, 200),
          projectKey: workItem.projectKey,
          awaitingApproval: result.awaitingApproval && result.status !== 'exception',
          exception: result.status === 'exception' ? { expiresAt: null } : null,
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
  return currentUserIsJiraAdmin();
}

async function requireApprover(accountId, workItem, record = null, ruleId = null) {
  if (!(await canCurrentUserApprove(accountId))) {
    const mode = await approverMode();
    throw new PreflightError(
      mode === 'named-approvers' ? 'Only a named Preflight approver can do this.' : 'Only a Jira admin can do this in small-team mode.',
    );
  }
  const settings = await getSettings();
  if (settings.separationOfDuties) {
    if (workItem?.reporterAccountId === accountId || workItem?.assigneeAccountId === accountId) {
      throw new PreflightError('Separation of duties is on: the reporter or assignee of a work item cannot approve it.');
    }
    const authors = Object.values(record?.answers?.[ruleId] || {}).map((a) => a.by);
    if (authors.includes(accountId)) throw new PreflightError('Separation of duties is on: you answered these questions, so another approver must approve.');
  }
}

function findApplicable(result, ruleId) {
  const match = result.applicable.find((m) => m.ruleId === ruleId);
  if (!match) throw new PreflightError(`Rule ${ruleId} does not apply to this work item.`);
  return match;
}

/* ---------------- answers ---------------- */

/** Save answers a PERSON typed or confirmed in the panel. The only way a requirement becomes satisfied. */
export async function saveAnswers(issueIdOrKey, ruleId, answers, actor) {
  const { workItem, rules, result } = await assess(issueIdOrKey);
  findApplicable(result, ruleId);
  const rule = rules.find((r) => r.id === ruleId);
  const allowed = new Map(rule.requirements.filter((r) => r.type !== 'approval').map((r) => [r.id, r]));
  const clean = {};
  for (const [reqId, value] of Object.entries(answers || {})) {
    if (!allowed.has(reqId)) throw new PreflightError(`Unknown requirement "${reqId}" for ${rule.title}.`);
    clean[reqId] = { value: String(value ?? '').slice(0, 2000), by: actor, at: Date.now() };
  }
  if (!Object.keys(clean).length) throw new PreflightError('Nothing to save.');
  await updateRecord(
    workItem.id,
    actor,
    `Answered ${[...Object.keys(clean)].map((id) => allowed.get(id).label).join(', ')} for "${rule.title}"`,
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
  const current = record.declaration?.value;
  if (value === 'no' && (current === 'yes' || current === 'unsure') && record.declaration.by !== actor) {
    // Someone else said this work affects personal information; only an approver can overrule that.
    await requireApprover(actor, workItem);
  }
  await updateRecord(workItem.id, actor, `Declared personal information impact: ${value}`, (rec) => {
    rec.declaration = { value, by: actor, at: Date.now(), via };
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
  await requireApprover(actor, workItem);
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
  await requireApprover(actor, workItem);
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
  const expiresAt = Date.now() + validDays * 24 * 60 * 60 * 1000;
  await updateRecord(workItem.id, actor, `Exception granted for ${validDays} day(s) covering ${titles.join(', ')}: ${redact(reason)}`, (rec) => {
    rec.exception = { by: actor, at: Date.now(), reason: redact(String(reason)).slice(0, 500), expiresAt, ruleIds };
  });
  return refresh(workItem.id);
}

export async function clearException(issueIdOrKey, actor) {
  const { workItem } = await assess(issueIdOrKey);
  await requireApprover(actor, workItem);
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
  const mentions = settings.approverAccountIds.slice(0, 5).flatMap((id) => [{ type: 'mention', attrs: { id } }, { type: 'text', text: ' ' }]);
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
    await syncIndexes(state.workItem, state.result);
  } catch (error) {
    console.warn('Preflight index sync failed', error.message);
  }
  return state;
}

export { stageOf };
