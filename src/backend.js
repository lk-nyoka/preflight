/**
 * Backend entry points that run without a UI: the workflow validator, the
 * product triggers, the install lifecycle hook, and the Rovo actions (which
 * the rovo:mcp module also exposes as MCP tools).
 */
import { assess, syncProperty, saveAnswers, requestApproval, flagRule, PreflightError } from './service.js';
import { getRules, saveRules, getSettings } from './store.js';
import { POPIA_RULES, POPIA_PACK_ID } from './rulepacks/popia.js';

/* ------------------------------------------------------------------ */
/* Workflow validator                                                  */
/* ------------------------------------------------------------------ */

/**
 * Called by Jira on every transition this validator is attached to.
 * Must answer quickly and must not call an LLM: it re-runs the deterministic
 * engine on the current issue text and the evidence in app storage.
 */
export async function validateTransition({ issue }) {
  try {
    const { workItem, result } = await assess(issue.id || issue.key, { asUser: false });
    if (result.status === 'blocked') {
      return {
        result: false,
        errorMessage: `Preflight: ${result.summary} Open the Preflight panel on ${workItem.key} to add the evidence or request approval.`,
      };
    }
    return { result: true };
  } catch (error) {
    console.error('Preflight validator failed', error);
    const { failClosed } = await getSettings().catch(() => ({ failClosed: false }));
    return failClosed
      ? { result: false, errorMessage: 'Preflight could not check this work item. Try again, or ask a Jira admin.' }
      : { result: true };
  }
}

/* ------------------------------------------------------------------ */
/* Product triggers                                                    */
/* ------------------------------------------------------------------ */

/** Re-evaluate when a work item is created or edited, so JQL and dashboards stay current. */
export async function onIssueChanged(event) {
  const issueId = event?.issue?.id;
  if (!issueId) return;
  try {
    const { workItem, result } = await assess(issueId, { asUser: false });
    await syncProperty(workItem, result);
  } catch (error) {
    console.error('Preflight trigger failed', issueId, error.message);
  }
}

/** On install, load the POPIA starter pack as DRAFTS. Nothing is enforced until an admin activates it. */
export async function onInstalled() {
  const existing = await getRules();
  if (existing.length) return;
  const now = Date.now();
  await saveRules(POPIA_RULES.map((r) => ({ ...r, status: 'draft', pack: POPIA_PACK_ID, updatedAt: now })));
}

/* ------------------------------------------------------------------ */
/* Rovo actions (also exposed as MCP tools)                            */
/* ------------------------------------------------------------------ */

function issueKeyFrom(payload) {
  return payload?.issueKey || payload?.context?.jira?.issueKey || payload?.context?.jira?.issueId || null;
}

function actorFrom(payload, context) {
  return context?.principal?.accountId || payload?.context?.principal?.accountId || 'rovo';
}

function fail(message) {
  return { ok: false, error: message };
}

/** Shape an evaluation for an LLM: compact, explicit, and with no claim of legal compliance. */
function forAgent(workItem, result) {
  return {
    ok: true,
    issueKey: workItem.key,
    summary: workItem.summary,
    preflightStatus: result.status,
    statusMeaning: {
      'not-applicable': 'No active privacy rule matched. This is not a statement that the work is compliant.',
      blocked: 'The workflow validator will block closing this work item until the open requirements are met.',
      clear: 'All required internal evidence and approvals are recorded.',
      exception: 'An approver recorded an exception.',
    }[result.status],
    message: result.summary,
    rules: result.applicable.map((m) => ({
      ruleId: m.ruleId,
      title: m.title,
      clause: m.clause,
      policyRef: m.policyRef,
      matchedBecause: m.why,
      requirements: m.requirements.map((r) => ({
        requirementId: r.id,
        label: r.label,
        type: r.type,
        options: r.options,
        satisfied: r.satisfied,
        reason: r.reason,
      })),
    })),
    dismissedRules: result.dismissed.map((d) => ({ ruleId: d.ruleId, title: d.title, reason: d.dismissal.reason })),
  };
}

export async function actionCheckIssue(payload) {
  const key = issueKeyFrom(payload);
  if (!key) return fail('Tell me which work item to check (for example PROJ-123).');
  try {
    const { workItem, result } = await assess(key);
    return forAgent(workItem, result);
  } catch (error) {
    return fail(error.message);
  }
}

export async function actionListRules() {
  const rules = await getRules();
  return {
    ok: true,
    note: 'Only active rules are enforced. Rules are the organisation\'s internal review steps, not legal advice.',
    rules: rules.map((r) => ({
      ruleId: r.id,
      title: r.title,
      status: r.status,
      clause: r.clause,
      summary: r.summary,
      requirements: (r.requirements || []).map((q) => ({ requirementId: q.id, label: q.label, type: q.type, options: q.options })),
    })),
  };
}

export async function actionSaveAnswer(payload, context) {
  const key = issueKeyFrom(payload);
  if (!key) return fail('Which work item?');
  if (!payload?.ruleId || !payload?.requirementId) return fail('ruleId and requirementId are required. Call check first.');
  try {
    const { workItem, result } = await saveAnswers(
      key,
      payload.ruleId,
      { [payload.requirementId]: payload.answer },
      actorFrom(payload, context),
      'rovo',
    );
    return forAgent(workItem, result);
  } catch (error) {
    return fail(error instanceof PreflightError ? error.message : `Could not save: ${error.message}`);
  }
}

export async function actionRequestApproval(payload, context) {
  const key = issueKeyFrom(payload);
  if (!key) return fail('Which work item?');
  try {
    return { ok: true, ...(await requestApproval(key, actorFrom(payload, context), payload?.message || '')) };
  } catch (error) {
    return fail(error.message);
  }
}

export async function actionFlagRule(payload, context) {
  const key = issueKeyFrom(payload);
  if (!key || !payload?.ruleId) return fail('issueKey and ruleId are required.');
  try {
    const { workItem, result } = await flagRule(key, payload.ruleId, actorFrom(payload, context));
    return forAgent(workItem, result);
  } catch (error) {
    return fail(error.message);
  }
}
