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
  withdrawProposal, applyDueReset, requireApproverForBulk, replacePack, confirmReset,
} from '../governance.js';
import { currentUserIsJiraAdmin, getCreatableIssueTypes, createIssue, getWorkflowCoverage } from '../jira.js';
import { PACKS, packFor, isStarterRule } from '../rulepacks/index.js';
import { PreflightError } from '../errors.js';
import { assess, syncIndexes } from '../service.js';
import { exampleWarnings } from '../rules.js';

const resolver = new Resolver();
const isPackRule = isStarterRule;

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
    packs: Object.values(PACKS).map((p) => ({ key: p.key, name: p.name, active: rules.filter((r) => String(r.pack || '').startsWith(p.prefix) && r.status === 'active').length, total: p.rules.length })),
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
  const pack = packFor(req.payload.pack);
  await replacePack(pack, 'draft', req.context.accountId);
  return adminState(req, { notice: `${pack.name} starter pack restored as drafts.` });
});

/** One click: activate a starter pack (POPIA by default) and create its five sample work items. */
define('loadDemo', async (req) => {
  await requireApproverForBulk(req.context.accountId);
  const projectKey = String(req.payload.projectKey || '').trim().toUpperCase();
  if (!/^[A-Z][A-Z0-9_]{1,9}$/.test(projectKey)) throw new PreflightError('Enter a space key such as PRIV.');
  const pack = packFor(req.payload.pack);
  const types = await getCreatableIssueTypes(projectKey);
  const type = types.find((t) => /task/i.test(t.name)) || types[0];
  if (!type) throw new PreflightError(`No work types can be created in ${projectKey}.`);
  // Create the work items first, so a permission problem leaves the rules untouched.
  const created = [];
  for (const demo of pack.demo) {
    try {
      const issue = await createIssue(projectKey, type.id, demo.summary, demo.description);
      created.push(issue.key);
    } catch (error) {
      if (/permission/i.test(error.message)) {
        throw new PreflightError(`Jira would not let Preflight create work items in ${projectKey}${created.length ? ` (created ${created.join(', ')} before stopping)` : ''}. ` +
          'Apps act through the project role "atlassian-addons-project-access". In Space settings > Permissions, make sure "Create work items", ' +
          '"Browse projects", "Edit work items" and "Add comments" include that role and "Application access: Any logged in user". ' +
          'In a team-managed space, set Access to Open, or use a company-managed space.');
      }
      throw error;
    }
  }
  await replacePack(pack, 'active', req.context.accountId);
  // Jira's "created" events fired before the rules were active, so check the new items now to fill the inbox.
  for (const key of created) {
    try {
      const state = await assess(key, { asUser: false });
      await syncIndexes(state.workItem, state.result, state.record);
    } catch (error) {
      console.warn('Preflight demo re-check failed', key, error.message);
    }
  }
  await audit(req, `Loaded demo in ${projectKey}: activated the ${pack.name} starter pack, created ${created.join(', ')}`);
  return adminState(req, { notice: `Activated the ${pack.name} starter pack and created ${created.join(', ')}.`, created });
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
  return adminState(req, { notice: 'Reset requested. Another Jira admin must confirm it. It takes effect 72 hours after your request unless an approver cancels it, and for 30 days afterwards you cannot approve, weaken a control or name the new approvers.' });
});

define('confirmReset', async (req) => {
  await confirmReset(req.context.accountId);
  return adminState(req, { notice: 'Reset confirmed. It takes effect 72 hours after it was requested unless an approver cancels it.' });
});

define('withdrawProposal', async (req) => {
  await withdrawProposal(req.payload.id, req.context.accountId);
  return adminState(req);
});

define('checkCoverage', async (req) => {
  try {
    const rows = await getWorkflowCoverage({ buildKey: 'preflight-build-gate', doneKey: 'preflight-done-gate' });
    if (!rows.length) return { ok: true, coverage: null, coverageError: `Preflight could not find any transitions into In Progress or Done statuses. Coverage is unknown, so check each workflow by hand. (Details for support: ${rows.diagnostic || 'none'})` };
    // One row per workflow, transition and gate (Jira repeats a transition name for each "from" status).
    const merged = new Map();
    for (const r of rows) {
      const key = `${r.workflow}|${r.transition}|${r.stage}`;
      merged.set(key, { ...r, protected: Boolean(merged.get(key)?.protected || r.protected) });
    }
    const all = [...merged.values()];
    // Workflows with at least one gate are the ones the team chose to review; list their gaps in detail.
    // Workflows with no gate at all (often unused defaults) are summarised so they don't bury the real gaps.
    const guarded = new Set(all.filter((r) => r.protected).map((r) => r.workflow));
    // No gate anywhere: say so plainly instead of listing every transition on the site.
    if (!guarded.size) {
      return { ok: true, coverage: null, noGates: true, otherWorkflows: [...new Set(all.map((r) => r.workflow))].sort(), diagnostic: rows.diagnostic || null };
    }
    const detail = guarded.size ? all.filter((r) => guarded.has(r.workflow)) : all;
    const others = guarded.size ? [...new Set(all.filter((r) => !guarded.has(r.workflow)).map((r) => r.workflow))].sort() : [];
    detail.sort((a, b) => Number(a.protected) - Number(b.protected) || a.workflow.localeCompare(b.workflow));
    return { ok: true, coverage: detail, workflows: new Set(detail.map((r) => r.workflow)).size, otherWorkflows: others };
  } catch (error) {
    return { ok: true, coverage: null, coverageError: `Could not read workflows: ${error.message}` };
  }
});

export const adminHandler = resolver.getDefinitions();
