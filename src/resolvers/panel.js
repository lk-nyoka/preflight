/**
 * Resolver for the Jira issue panel.
 *
 * The issue always comes from the extension context Jira supplies, never from
 * the payload, so a user cannot act on a work item they are not viewing.
 */
import Resolver from '@forge/resolver';
import {
  assess, saveAnswers, approve, revokeApproval, flagRule, dismissRule, restoreRule, setException, clearException,
  requestApproval, canCurrentUserApprove, approverMode, syncIndexes, declare, discardDraft, PreflightError,
} from '../service.js';
import { getSettings, getGates, listAudit } from '../store.js';

const resolver = new Resolver();

function issueFrom(req) {
  const issue = req.context?.extension?.issue;
  if (!issue?.id) throw new PreflightError('Open Preflight from a work item.');
  return issue.id;
}

async function view(state, accountId, extra = {}) {
  const [settings, gates, audit, canApprove, mode] = await Promise.all([
    getSettings(),
    getGates().catch(() => ({})),
    listAudit(state.workItem.id, { limit: 20 }).catch(() => []),
    canCurrentUserApprove(accountId).catch(() => false),
    approverMode(),
  ]);
  return {
    ok: true,
    issue: { id: state.workItem.id, key: state.workItem.key, summary: state.workItem.summary },
    result: state.result,
    canApprove,
    approverMode: mode,
    approvers: settings.approverAccountIds,
    requireDeclaration: settings.requireDeclaration,
    selfApprovalBlocked: Boolean(settings.separationOfDuties && state.workItem.reporterAccountId === accountId),
    exception: state.record.exception,
    answers: state.record.answers || {},
    drafts: state.record.drafts || {},
    declaration: state.record.declaration,
    gate: gates[state.workItem.projectKey] || null,
    audit,
    flaggableRules: state.rules
      .filter((r) => r.status === 'active' && !state.result.applicable.some((m) => m.ruleId === r.id))
      .map((r) => ({ id: r.id, title: r.title, clause: r.clause })),
    hasActiveRules: state.rules.some((r) => r.status === 'active'),
    ...extra,
  };
}

function define(name, fn) {
  resolver.define(name, async (req) => {
    try {
      return await fn(req);
    } catch (error) {
      if (!(error instanceof PreflightError) && error.code !== 'BUSY') console.error(`panel.${name}`, error);
      return { ok: false, error: error.message };
    }
  });
}

const me = (req) => req.context.accountId;

define('getState', async (req) => {
  const state = await assess(issueFrom(req));
  syncIndexes(state.workItem, state.result).catch(() => {});
  return view(state, me(req));
});

define('saveAnswers', async (req) => view(await saveAnswers(issueFrom(req), req.payload.ruleId, req.payload.answers, me(req)), me(req)));
define('discardDraft', async (req) => view(await discardDraft(issueFrom(req), req.payload.ruleId, req.payload.requirementId, me(req)), me(req)));
define('declare', async (req) => view(await declare(issueFrom(req), req.payload.value, me(req)), me(req)));
define('approve', async (req) => view(await approve(issueFrom(req), req.payload.ruleId, me(req), req.payload.note), me(req)));
define('revokeApproval', async (req) => view(await revokeApproval(issueFrom(req), req.payload.ruleId, me(req)), me(req)));
define('flagRule', async (req) => view(await flagRule(issueFrom(req), req.payload.ruleId, me(req)), me(req)));
define('dismissRule', async (req) => view(await dismissRule(issueFrom(req), req.payload.ruleId, me(req), req.payload.reason), me(req)));
define('restoreRule', async (req) => view(await restoreRule(issueFrom(req), req.payload.ruleId, me(req)), me(req)));
define('setException', async (req) => view(await setException(issueFrom(req), me(req), req.payload.reason, req.payload.days), me(req)));
define('clearException', async (req) => view(await clearException(issueFrom(req), me(req)), me(req)));

define('requestApproval', async (req) => {
  const outcome = await requestApproval(issueFrom(req), me(req), req.payload?.message);
  const state = await assess(issueFrom(req));
  return view(state, me(req), { notice: outcome.posted ? 'Approval requested in a comment.' : outcome.reason });
});

export const panelHandler = resolver.getDefinitions();
