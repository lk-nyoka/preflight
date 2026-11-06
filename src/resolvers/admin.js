/**
 * Resolver for the Preflight admin page (Jira settings > Apps > Preflight).
 *
 * Jira only shows admin pages to administrators, but resolvers are network
 * endpoints, so every handler checks the permission again on the server.
 */
import Resolver from '@forge/resolver';
import { evaluate } from '../engine/evaluate.js';
import { getRules, saveRules, getSettings, saveSettings } from '../store.js';
import { currentUserIsJiraAdmin, getCreatableIssueTypes, createIssue } from '../jira.js';
import { POPIA_RULES, POPIA_PACK_ID, DEMO_ISSUES } from '../rulepacks/popia.js';
import { PreflightError } from '../service.js';

const resolver = new Resolver();
const TYPES = ['answer', 'choice', 'link', 'approval'];

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

async function adminState(extra = {}) {
  return { ok: true, rules: await getRules(), settings: await getSettings(), ...extra };
}

/** Validate a rule coming from the editor so a typo cannot break enforcement. */
function cleanRule(input, existing) {
  const id = String(input.id || existing?.id || '').trim();
  if (!/^[a-z0-9-]{3,60}$/.test(id)) throw new PreflightError('Rule id must be 3-60 lowercase letters, digits or dashes.');
  const title = String(input.title || '').trim();
  if (!title) throw new PreflightError('Rule needs a title.');
  const split = (v) =>
    (Array.isArray(v) ? v : String(v || '').split(/[\n,]/)).map((s) => String(s).trim()).filter(Boolean);
  const keywords = split(input.keywords ?? input.triggers?.keywords);
  const labels = split(input.labels ?? input.triggers?.labels);
  if (!keywords.length && !labels.length) throw new PreflightError('Add at least one trigger keyword or label.');

  let requirements = input.requirements;
  if (typeof requirements === 'string') {
    try {
      requirements = JSON.parse(requirements);
    } catch {
      throw new PreflightError('Requirements must be valid JSON.');
    }
  }
  if (!Array.isArray(requirements) || !requirements.length) throw new PreflightError('Add at least one requirement.');
  const seen = new Set();
  requirements = requirements.map((r) => {
    if (!r?.id || !r?.label || !TYPES.includes(r.type)) {
      throw new PreflightError(`Each requirement needs id, label and type (${TYPES.join(', ')}).`);
    }
    if (seen.has(r.id)) throw new PreflightError(`Duplicate requirement id "${r.id}".`);
    seen.add(r.id);
    if (r.type === 'choice' && (!Array.isArray(r.options) || r.options.length < 2)) {
      throw new PreflightError(`"${r.label}" is a choice, so it needs at least two options.`);
    }
    return { id: r.id, label: r.label, type: r.type, help: r.help, clause: r.clause, options: r.options, minLength: r.minLength };
  });

  return {
    ...(existing || {}),
    id,
    title,
    clause: String(input.clause || '').trim() || 'Internal policy',
    policyRef: String(input.policyRef || '').trim() || null,
    summary: String(input.summary || '').trim(),
    severity: input.severity === 'medium' ? 'medium' : 'high',
    triggers: { keywords, labels },
    requirements,
    status: existing?.status || 'draft',
    updatedAt: Date.now(),
  };
}

define('getState', async () => adminState());

define('saveRule', async (req) => {
  const rules = await getRules();
  const index = rules.findIndex((r) => r.id === req.payload.originalId);
  const rule = cleanRule(req.payload.rule, index >= 0 ? rules[index] : null);
  if (index < 0 && rules.some((r) => r.id === rule.id)) throw new PreflightError(`A rule with id ${rule.id} already exists.`);
  if (index >= 0) rules[index] = rule;
  else rules.push(rule);
  await saveRules(rules);
  return adminState({ notice: `Saved "${rule.title}". Approvals given before this edit now need re-approval.` });
});

define('setRuleStatus', async (req) => {
  const rules = await getRules();
  const rule = rules.find((r) => r.id === req.payload.id);
  if (!rule) throw new PreflightError('Rule not found.');
  rule.status = req.payload.status === 'active' ? 'active' : 'draft';
  rule.activatedBy = rule.status === 'active' ? req.context.accountId : null;
  rule.activatedAt = rule.status === 'active' ? Date.now() : null;
  await saveRules(rules);
  return adminState();
});

define('deleteRule', async (req) => {
  await saveRules((await getRules()).filter((r) => r.id !== req.payload.id));
  return adminState();
});

/** "Test your rule": run the engine over sample text against every rule, active or draft. */
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
      requirements: m.requirements.map((r) => r.label),
    })),
  };
});

/** Put the POPIA starter pack back as drafts, keeping any custom (non-pack) rules. */
define('resetPack', async () => {
  const custom = (await getRules()).filter((r) => r.pack !== POPIA_PACK_ID);
  const now = Date.now();
  await saveRules([...POPIA_RULES.map((r) => ({ ...r, status: 'draft', pack: POPIA_PACK_ID, updatedAt: now })), ...custom]);
  return adminState({ notice: 'POPIA starter pack restored as drafts.' });
});

/**
 * One-click demo: activate the POPIA starter pack and create five sample work
 * items in a project the admin picks. Attaching the validator to a workflow is
 * still a manual Jira step (see the instructions on the page).
 */
define('loadDemo', async (req) => {
  const projectKey = String(req.payload.projectKey || '').trim().toUpperCase();
  if (!/^[A-Z][A-Z0-9_]{1,9}$/.test(projectKey)) throw new PreflightError('Enter a project key such as PRIV.');

  const now = Date.now();
  const custom = (await getRules()).filter((r) => r.pack !== POPIA_PACK_ID);
  await saveRules([
    ...POPIA_RULES.map((r) => ({ ...r, status: 'active', pack: POPIA_PACK_ID, updatedAt: now, activatedBy: req.context.accountId, activatedAt: now })),
    ...custom,
  ]);

  const types = await getCreatableIssueTypes(projectKey);
  const type = types.find((t) => /task/i.test(t.name)) || types[0];
  if (!type) throw new PreflightError(`No issue types can be created in ${projectKey}.`);

  const created = [];
  for (const demo of DEMO_ISSUES) {
    const issue = await createIssue(projectKey, type.id, demo.summary, demo.description);
    created.push(issue.key);
  }
  return adminState({ notice: `Activated the POPIA starter pack and created ${created.join(', ')}.`, created });
});

define('saveSettings', async (req) => {
  const patch = {};
  if (Array.isArray(req.payload.approverAccountIds)) {
    patch.approverAccountIds = req.payload.approverAccountIds.filter((id) => typeof id === 'string').slice(0, 20);
  }
  if (typeof req.payload.failClosed === 'boolean') patch.failClosed = req.payload.failClosed;
  if (typeof req.payload.separationOfDuties === 'boolean') patch.separationOfDuties = req.payload.separationOfDuties;
  await saveSettings(patch);
  return adminState({ notice: 'Settings saved.' });
});

export const adminHandler = resolver.getDefinitions();
