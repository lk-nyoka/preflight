/**
 * Resolver for the Jira issue panel.
 *
 * The issue is always taken from the extension context Jira supplies, never
 * from the payload, so a user cannot act on an issue they are not viewing.
 */
import Resolver from '@forge/resolver';
import {
  assess, saveAnswers, approve, revokeApproval, flagRule, dismissRule, restoreRule,
  setException, clearException, requestApproval, canCurrentUserApprove, syncProperty, PreflightError,
} from '../service.js';
import { getSettings } from '../store.js';

const resolver = new Resolver();

function issueFrom(req) {
  const issue = req.context?.extension?.issue;
  if (!issue?.id) throw new PreflightError('Open Preflight from a work item.');
  return issue.id;
}

async function view(state, accountId) {
  const settings = await getSettings();
  const canApprove = await canCurrentUserApprove(accountId).catch(() => false);
  return {
    ok: true,
    issue: { id: state.workItem.id, key: state.workItem.key, summary: state.workItem.summary },
    result: state.result,
    canApprove,
    selfApprovalBlocked: Boolean(settings.separationOfDuties && state.workItem.reporterAccountId === accountId),
    exception: state.record.exception,
    answers: state.record.answers || {},
    audit: (state.record.audit || []).slice(0, 15),
    flaggableRules: state.rules
      .filter((r) => r.status === 'active' && !state.result.applicable.some((m) => m.ruleId === r.id))
      .map((r) => ({ id: r.id, title: r.title, clause: r.clause })),
    hasActiveRules: state.rules.some((r) => r.status === 'active'),
  };
}

/** Wrap each handler so errors reach the UI as a readable message instead of a crash. */
function define(name, fn) {
  resolver.define(name, async (req) => {
    try {
      return await fn(req);
    } catch (error) {
      if (!(error instanceof PreflightError)) console.error(`panel.${name}`, error);
      return { ok: false, error: error.message };
    }
  });
}

define('getState', async (req) => {
  const state = await assess(issueFrom(req));
  syncProperty(state.workItem, state.result).catch(() => {});
  return view(state, req.context.accountId);
});

define('saveAnswers', async (req) =>
  view(await saveAnswers(issueFrom(req), req.payload.ruleId, req.payload.answers, req.context.accountId), req.context.accountId),
);

define('approve', async (req) =>
  view(await approve(issueFrom(req), req.payload.ruleId, req.context.accountId, req.payload.note), req.context.accountId),
);

define('revokeApproval', async (req) =>
  view(await revokeApproval(issueFrom(req), req.payload.ruleId, req.context.accountId), req.context.accountId),
);

define('flagRule', async (req) =>
  view(await flagRule(issueFrom(req), req.payload.ruleId, req.context.accountId), req.context.accountId),
);

define('dismissRule', async (req) =>
  view(await dismissRule(issueFrom(req), req.payload.ruleId, req.context.accountId, req.payload.reason), req.context.accountId),
);

define('restoreRule', async (req) =>
  view(await restoreRule(issueFrom(req), req.payload.ruleId, req.context.accountId), req.context.accountId),
);

define('setException', async (req) =>
  view(await setException(issueFrom(req), req.context.accountId, req.payload.reason), req.context.accountId),
);

define('clearException', async (req) =>
  view(await clearException(issueFrom(req), req.context.accountId), req.context.accountId),
);

define('requestApproval', async (req) => {
  const outcome = await requestApproval(issueFrom(req), req.context.accountId, req.payload?.message);
  const state = await assess(issueFrom(req));
  return { ...(await view(state, req.context.accountId)), notice: outcome.posted ? 'Approval requested in a comment.' : outcome.reason };
});

export const panelHandler = resolver.getDefinitions();
