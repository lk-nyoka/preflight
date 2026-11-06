/**
 * Preflight service layer.
 *
 * Every surface (issue panel, Rovo actions, MCP tools, validator, trigger)
 * goes through these functions, so rules about who may do what live in one
 * place. AI never approves anything: approve/dismiss/exception all require a
 * human approver, checked here on the server.
 */
import { evaluate, answersFingerprint } from './engine/evaluate.js';
import { getRules, getSettings, getRecord, updateRecord } from './store.js';
import { getWorkItem, currentUserIsJiraAdmin, setPreflightProperty, getPreflightProperty, addComment } from './jira.js';

export class PreflightError extends Error {}

/** Load the work item, rules and evidence, and run the engine. */
export async function assess(issueIdOrKey, { asUser = true } = {}) {
  const workItem = await getWorkItem(issueIdOrKey, { asUser });
  const [rules, record] = await Promise.all([getRules(), getRecord(workItem.id)]);
  const result = evaluate(workItem, rules, record);
  return { workItem, rules, record, result };
}

/** Keep the JQL-searchable mirror in step with the latest evaluation. */
export async function syncProperty(workItem, result) {
  const next = {
    status: result.status,
    open: result.openCount,
    rules: result.applicable.map((m) => m.ruleId),
  };
  const current = await getPreflightProperty(workItem.id);
  const changed =
    !current || current.status !== next.status || current.open !== next.open || current.rules?.join() !== next.rules.join();
  if (changed) await setPreflightProperty(workItem.id, { ...next, evaluatedAt: Date.now() });
  return changed;
}

/** Approvers: anyone listed in settings, plus Jira administrators. Only valid for the signed-in user. */
export async function canCurrentUserApprove(accountId) {
  const settings = await getSettings();
  if (settings.approverAccountIds.includes(accountId)) return true;
  return currentUserIsJiraAdmin();
}

async function requireApprover(accountId, workItem) {
  if (!(await canCurrentUserApprove(accountId))) {
    throw new PreflightError('Only a Preflight approver (or a Jira admin) can do this.');
  }
  const settings = await getSettings();
  if (settings.separationOfDuties && workItem?.reporterAccountId === accountId) {
    throw new PreflightError('Separation of duties is on: the reporter of a work item cannot approve it.');
  }
}

function findApplicable(result, ruleId) {
  const match = result.applicable.find((m) => m.ruleId === ruleId);
  if (!match) throw new PreflightError(`Rule ${ruleId} does not apply to this work item.`);
  return match;
}

/** Save answers to the non-approval requirements of one rule. Anyone who can see the issue may answer. */
export async function saveAnswers(issueIdOrKey, ruleId, answers, actor, via = 'panel') {
  const { workItem, rules, result } = await assess(issueIdOrKey);
  findApplicable(result, ruleId);
  const rule = rules.find((r) => r.id === ruleId);
  const allowed = new Set(rule.requirements.filter((r) => r.type !== 'approval').map((r) => r.id));
  const clean = {};
  for (const [reqId, value] of Object.entries(answers || {})) {
    if (!allowed.has(reqId)) throw new PreflightError(`Unknown requirement "${reqId}" for ${rule.title}.`);
    clean[reqId] = { value: String(value ?? '').slice(0, 2000), by: actor, at: Date.now(), via };
  }
  await updateRecord(workItem.id, actor, `Answered ${Object.keys(clean).join(', ')} for "${rule.title}" (${via})`, (rec) => {
    rec.answers[ruleId] = { ...(rec.answers[ruleId] || {}), ...clean };
  });
  return refresh(workItem.id);
}

export async function approve(issueIdOrKey, ruleId, actor, note = '') {
  const { workItem, record, result } = await assess(issueIdOrKey);
  await requireApprover(actor, workItem);
  const match = findApplicable(result, ruleId);
  const unanswered = match.requirements.filter((r) => r.type !== 'approval' && !r.satisfied);
  if (unanswered.length) {
    throw new PreflightError(`Answer these first: ${unanswered.map((r) => r.label).join(', ')}.`);
  }
  const fingerprint = answersFingerprint(record.answers[ruleId] || {});
  await updateRecord(workItem.id, actor, `Approved "${match.title}"${note ? `: ${note}` : ''}`, (rec) => {
    rec.approvals[ruleId] = { by: actor, at: Date.now(), fingerprint, note: String(note).slice(0, 500) };
  });
  return refresh(workItem.id);
}

export async function revokeApproval(issueIdOrKey, ruleId, actor) {
  const { workItem } = await assess(issueIdOrKey);
  await requireApprover(actor, workItem);
  await updateRecord(workItem.id, actor, `Revoked approval for ${ruleId}`, (rec) => {
    delete rec.approvals[ruleId];
  });
  return refresh(workItem.id);
}

/** Anyone can flag a rule that keyword matching missed. Removing a flag needs an approver. */
export async function flagRule(issueIdOrKey, ruleId, actor) {
  const { workItem, rules } = await assess(issueIdOrKey);
  const rule = rules.find((r) => r.id === ruleId && r.status === 'active');
  if (!rule) throw new PreflightError('That rule is not active.');
  await updateRecord(workItem.id, actor, `Flagged "${rule.title}" manually`, (rec) => {
    rec.manual = [...new Set([...(rec.manual || []), ruleId])];
    delete rec.dismissals[ruleId];
  });
  return refresh(workItem.id);
}

/** An approver marks a matched rule as not relevant (false positive), with a reason. */
export async function dismissRule(issueIdOrKey, ruleId, actor, reason) {
  if (!String(reason || '').trim()) throw new PreflightError('Give a reason for dismissing the rule.');
  const { workItem, result } = await assess(issueIdOrKey);
  await requireApprover(actor, workItem);
  const match = findApplicable(result, ruleId);
  await updateRecord(workItem.id, actor, `Dismissed "${match.title}": ${reason}`, (rec) => {
    rec.dismissals[ruleId] = { by: actor, at: Date.now(), reason: String(reason).slice(0, 500) };
    rec.manual = (rec.manual || []).filter((id) => id !== ruleId);
  });
  return refresh(workItem.id);
}

export async function restoreRule(issueIdOrKey, ruleId, actor) {
  const { workItem } = await assess(issueIdOrKey);
  await requireApprover(actor, workItem);
  await updateRecord(workItem.id, actor, `Restored ${ruleId}`, (rec) => {
    delete rec.dismissals[ruleId];
  });
  return refresh(workItem.id);
}

export async function setException(issueIdOrKey, actor, reason) {
  if (!String(reason || '').trim()) throw new PreflightError('Give a reason for the exception.');
  const { workItem } = await assess(issueIdOrKey);
  await requireApprover(actor, workItem);
  await updateRecord(workItem.id, actor, `Exception granted: ${reason}`, (rec) => {
    rec.exception = { by: actor, at: Date.now(), reason: String(reason).slice(0, 500) };
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

/** Post a comment that @mentions the configured approvers and lists what is waiting on them. */
export async function requestApproval(issueIdOrKey, actor, message = '') {
  const { workItem, result } = await assess(issueIdOrKey);
  if (result.status !== 'blocked') return { posted: false, reason: `Nothing to approve: ${result.summary}` };
  const settings = await getSettings();
  const mentions = settings.approverAccountIds.slice(0, 5).flatMap((id) => [
    { type: 'mention', attrs: { id } },
    { type: 'text', text: ' ' },
  ]);
  const lines = result.open.map((o) => `• ${o.ruleTitle} (${o.ruleClause}): ${o.label}, ${o.reason.toLowerCase()}`);
  const body = {
    type: 'doc',
    version: 1,
    content: [
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: 'Preflight review requested ', marks: [{ type: 'strong' }] },
          ...(mentions.length ? mentions : [{ type: 'text', text: '(no approvers configured; Jira admins can approve) ' }]),
        ],
      },
      ...(message ? [{ type: 'paragraph', content: [{ type: 'text', text: String(message).slice(0, 1000) }] }] : []),
      ...lines.map((line) => ({ type: 'paragraph', content: [{ type: 'text', text: line }] })),
    ],
  };
  await addComment(workItem.key, body);
  await updateRecord(workItem.id, actor, 'Requested approval', () => {});
  return { posted: true, notified: settings.approverAccountIds.length, open: result.openCount };
}

/** Re-evaluate after a change and update the searchable mirror. */
async function refresh(issueId) {
  const state = await assess(issueId);
  try {
    await syncProperty(state.workItem, state.result);
  } catch (error) {
    console.warn('Preflight property sync failed', error.message);
  }
  return state;
}
