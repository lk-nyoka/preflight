/**
 * Resolver for the Preflight admin page (Jira settings > Apps > Preflight).
 *
 * Jira only shows admin pages to administrators, but resolvers are network
 * endpoints, so every handler re-checks on the server. Every change writes a
 * write-once audit event in the "admin" scope.
 */
import Resolver from '@forge/resolver';
import { evaluate } from '../engine/evaluate.js';
import { getRules, getSettings, getGates, appendAudit, listAudit } from '../store.js';
import {
  saveRuleChange, setRuleStatusChange, deleteRuleChange, setApprovers, requestReset, setPolicy, pendingRuleChanges,
  withdrawProposal, applyDueReset, requireApproverForBulk, replacePack,
} from '../governance.js';
import { currentUserIsJiraAdmin, getCreatableIssueTypes, createIssue, getWorkflowCoverage } from '../jira.js';
import { POPIA_RULES, POPIA_PACK_ID, DEMO_ISSUES } from '../rulepacks/popia.js';
import { PreflightError } from '../errors.js';
import { exampleWarnings } from '../rules.js';

const resolver = new Resolver();
const isPackRule = (r) => String(r.pack || '').startsWith('popia-starter');

function define(name, fn) {
  resolver.define(name, async (req) => {
    try {
      if (!(await currentUserIsJiraAdmin())) throw new PreflightError('Only Jira administrators can change Preflight.');
      return await fn(req);
    } catch (error) {
      if (!(error instanceof PreflightError)) console.error(`admin.${name}`, error);
      return { ok: false, error: error.message };
    }
  });
}

const audit = (req, event, details = {}) => appendAudit('admin', { by: req.context.accountId, via: 'admin', event, ...details });

async function adminState(req, extra = {}) {
  await applyDueReset();
  const [rules, settings, gates, log, pending] = await Promise.all([
    getRules(), getSettings(), getGates(), listAudit('admin', { limit: 40 }), pendingRuleChanges(),
  ]);
  return {
    ok: true,
    me: req.context.accountId,
    pending,
    rules: rules.map((r) => ({ ...r, warnings: exampleWarnings(r) })),
    settings,
    gates,
    audit: log,
    ...extra,
  };
}

define('getState', async (req) => adminState(req));

define('saveRule', async (req) => {
  const out = await saveRuleChange(req.payload.rule, req.payload.originalId, req.context.accountId);
  const saved = out.rules.find((r) => r.id === (req.payload.rule?.id || req.payload.originalId)) || null;
  const warnings = saved ? exampleWarnings(saved.pending?.rule || saved) : [];
  return adminState(req, { notice: `${out.notice}${warnings.length ? ` ${warnings.length} example(s) fail; see the rule.` : ''}` });
});

define('setRuleStatus', async (req) => {
  const out = await setRuleStatusChange(req.payload.id, req.payload.status, req.context.accountId, req.payload.reason);
  return adminState(req, { notice: out.notice });
});

/** Only drafts can be deleted, so deleting can never silently clear blocked work. */
define('deleteRule', async (req) => {
  await deleteRuleChange(req.payload.id, req.context.accountId);
  return adminState(req);
});

/** "Test a rule": run sample text against every rule, active or draft. */
define('testText', async (req) => {
  const rules = (await getRules()).map((r) => ({ ...r, originalStatus: r.status, status: 'active' }));
  const result = evaluate({ text: String(req.payload.text || '') }, rules, {});
  return {
    ok: true,
    matches: result.applicable.map((m) => ({
      ruleId: m.ruleId,
      title: m.title,
      clause: m.clause,
      keywords: m.why.keywords,
      snippet: m.why.snippet,
      enforced: rules.find((r) => r.id === m.ruleId)?.originalStatus === 'active',
      requirements: m.requirements.map((r) => `${r.label} (${r.stage === 'done' ? 'before Done' : 'before build'})`),
    })),
  };
});

define('resetPack', async (req) => {
  await requireApproverForBulk(req.context.accountId);
  await replacePack(POPIA_RULES, POPIA_PACK_ID, 'draft', req.context.accountId);
  await audit(req, 'Restored the POPIA starter pack as drafts');
  return adminState(req, { notice: 'POPIA starter pack restored as drafts.' });
});

/** One click: activate the POPIA pack and create five sample work items. */
define('loadDemo', async (req) => {
  await requireApproverForBulk(req.context.accountId);
  const projectKey = String(req.payload.projectKey || '').trim().toUpperCase();
  if (!/^[A-Z][A-Z0-9_]{1,9}$/.test(projectKey)) throw new PreflightError('Enter a project key such as PRIV.');
  const types = await getCreatableIssueTypes(projectKey);
  const type = types.find((t) => /task/i.test(t.name)) || types[0];
  if (!type) throw new PreflightError(`No work types can be created in ${projectKey}.`);
  await replacePack(POPIA_RULES, POPIA_PACK_ID, 'active', req.context.accountId);
  const created = [];
  for (const demo of DEMO_ISSUES) {
    const issue = await createIssue(projectKey, type.id, demo.summary, demo.description);
    created.push(issue.key);
  }
  await audit(req, `Loaded demo in ${projectKey}: activated POPIA starter pack, created ${created.join(', ')}`);
  return adminState(req, { notice: `Activated the POPIA starter pack and created ${created.join(', ')}.`, created });
});

/**
 * Settings. Approver governance lives in governance.js: once approvers are
 * named, only a current approver can change the list or weaken a control.
 */
define('saveSettings', async (req) => {
  if (Array.isArray(req.payload.approverAccountIds)) await setApprovers(req.payload.approverAccountIds, req.context.accountId);
  const policy = {};
  for (const key of ['failClosed', 'separationOfDuties', 'requireDeclaration']) {
    if (typeof req.payload[key] === 'boolean') policy[key] = req.payload[key];
  }
  if (Object.keys(policy).length) await setPolicy(policy, req.context.accountId);
  return adminState(req, { notice: 'Settings saved.' });
});

define('requestReset', async (req) => {
  await requestReset(req.context.accountId, req.payload.reason);
  return adminState(req, { notice: 'Reset requested. It takes effect in 72 hours unless an approver cancels it, and you cannot name yourself approver afterwards.' });
});

define('withdrawProposal', async (req) => {
  await withdrawProposal(req.payload.id, req.context.accountId);
  return adminState(req);
});

define('checkCoverage', async (req) => {
  try {
    const rows = await getWorkflowCoverage({ buildKey: 'preflight-build-gate', doneKey: 'preflight-done-gate' });
    if (!rows.length) return { ok: true, coverage: null, coverageError: 'Preflight could not find any transitions into In Progress or Done statuses. Coverage is unknown, so check each workflow by hand.' };
    return { ok: true, coverage: rows, workflows: new Set(rows.map((r) => r.workflow)).size };
  } catch (error) {
    return { ok: true, coverage: null, coverageError: `Could not read workflows: ${error.message}` };
  }
});

export const adminHandler = resolver.getDefinitions();
