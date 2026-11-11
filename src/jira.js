/**
 * Thin helpers around the Jira Cloud REST API.
 *
 * asUser() is used whenever a person is behind the call, so Jira enforces that
 * person's own permissions. asApp() is used only by the workflow validator and
 * the product trigger, which run without a user session, and only for reads
 * plus writing Preflight's own issue property.
 */
import api, { route } from '@forge/api';

const FIELDS = 'summary,description,labels,project,reporter,assignee,status,parent';

/** Flatten Atlassian Document Format (or a plain string) to text. */
export function adfToText(node) {
  if (!node) return '';
  if (typeof node === 'string') return node;
  if (Array.isArray(node)) return node.map(adfToText).join(' ');
  const own = node.type === 'text' ? node.text || '' : '';
  const children = node.content ? adfToText(node.content) : '';
  const breakAfter = ['paragraph', 'heading', 'listItem', 'tableRow'].includes(node.type) ? '\n' : ' ';
  return `${own}${children}${breakAfter}`;
}

/** Plain-text ADF document, used for comments. */
export function textToAdf(text) {
  return {
    type: 'doc',
    version: 1,
    content: String(text)
      .split('\n')
      .map((line) => ({ type: 'paragraph', content: line ? [{ type: 'text', text: line }] : [] })),
  };
}

async function readJson(response, what) {
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`${what} failed (${response.status}): ${body.slice(0, 300)}`);
  }
  return response.status === 204 ? null : response.json();
}

/** Fetch a work item and return the shape the engine needs. */
export async function getWorkItem(issueIdOrKey, { asUser = true } = {}) {
  const requester = asUser ? api.asUser() : api.asApp();
  const issue = await readJson(
    await requester.requestJira(route`/rest/api/3/issue/${issueIdOrKey}?fields=${FIELDS}`, {
      headers: { Accept: 'application/json' },
    }),
    `Reading ${issueIdOrKey}`,
  );
  const summary = issue.fields?.summary || '';
  const description = adfToText(issue.fields?.description);
  // Sub-tasks inherit their parent's wording, so splitting work into neutrally worded sub-tasks does not dodge a rule.
  const parentSummary = issue.fields?.parent?.fields?.summary || '';
  return {
    id: issue.id,
    key: issue.key,
    summary,
    parentKey: issue.fields?.parent?.key || null,
    assigneeAccountId: issue.fields?.assignee?.accountId || null,
    projectKey: issue.fields?.project?.key,
    reporterAccountId: issue.fields?.reporter?.accountId || null,
    status: issue.fields?.status?.name,
    statusCategory: issue.fields?.status?.statusCategory?.key || null, // new | indeterminate | done
    labels: issue.fields?.labels || [],
    text: `${summary}\n${description}${parentSummary ? `\n${parentSummary}` : ''}`,
  };
}

/** A user's display name (for gate messages). Uses the app's access; returns null if hidden. */
export async function getDisplayName(accountId) {
  const response = await api.asApp().requestJira(route`/rest/api/3/user?accountId=${accountId}`, { headers: { Accept: 'application/json' } });
  if (!response.ok) return null;
  const user = await response.json();
  return user?.displayName || null;
}

/** Does the signed-in user hold the Jira "Administer" global permission? */
export async function currentUserIsJiraAdmin() {
  const data = await readJson(
    await api.asUser().requestJira(route`/rest/api/3/mypermissions?permissions=ADMINISTER`, {
      headers: { Accept: 'application/json' },
    }),
    'Checking permissions',
  );
  return Boolean(data?.permissions?.ADMINISTER?.havePermission);
}

/** Add a comment as the signed-in user (or as the app, from triggers that have no user). */
export async function addComment(issueIdOrKey, adfBody, { asApp = false } = {}) {
  return readJson(
    await (asApp ? api.asApp() : api.asUser()).requestJira(route`/rest/api/3/issue/${issueIdOrKey}/comment`, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ body: adfBody }),
    }),
    'Adding comment',
  );
}

/**
 * Write the searchable summary property (indexed by the jira:entityProperty
 * module so JQL like  preflightStatus = blocked  works). This is a mirror for
 * search and dashboards only; enforcement always re-evaluates from app storage.
 */
export async function setPreflightProperty(issueId, value) {
  return readJson(
    await api.asApp().requestJira(route`/rest/api/3/issue/${issueId}/properties/preflight`, {
      method: 'PUT',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify(value),
    }),
    'Saving Preflight property',
  );
}

export async function getPreflightProperty(issueId) {
  const response = await api.asApp().requestJira(route`/rest/api/3/issue/${issueId}/properties/preflight`, {
    headers: { Accept: 'application/json' },
  });
  if (response.status === 404) return null;
  const data = await readJson(response, 'Reading Preflight property');
  return data?.value || null;
}

/** Issue types that can be created in a project (used by the demo loader). */
export async function getCreatableIssueTypes(projectKey) {
  const data = await readJson(
    await api.asUser().requestJira(route`/rest/api/3/issue/createmeta/${projectKey}/issuetypes`, {
      headers: { Accept: 'application/json' },
    }),
    `Reading issue types for ${projectKey}`,
  );
  return (data?.issueTypes || data?.values || []).filter((t) => !t.subtask);
}

export async function createIssue(projectKey, issueTypeId, summary, description) {
  return readJson(
    await api.asUser().requestJira(route`/rest/api/3/issue`, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fields: {
          project: { key: projectKey },
          issuetype: { id: issueTypeId },
          summary,
          description: textToAdf(description),
          labels: ['preflight-demo'],
        },
      }),
    }),
    `Creating "${summary}"`,
  );
}

/**
 * Status category of a status id: 'new' (To Do), 'indeterminate' (In Progress)
 * or 'done'. Used by the validator to decide which stage of review applies.
 */
export async function getStatusCategory(statusId) {
  const data = await readJson(
    await api.asApp().requestJira(route`/rest/api/3/status/${statusId}`, { headers: { Accept: 'application/json' } }),
    `Reading status ${statusId}`,
  );
  return data?.statusCategory?.key || null;
}

/* ------------------------------------------------------------------ */
/* Workflow coverage (admin only, best effort)                         */
/* ------------------------------------------------------------------ */

const DONE_CATEGORIES = new Set(['DONE', 'done', 'COMPLETE']);
const PROGRESS_CATEGORIES = new Set(['IN_PROGRESS', 'INDETERMINATE', 'indeterminate', 'in_progress']);

async function pages(pathFor, limit = 20) {
  const out = [];
  for (let page = 0; page < limit; page += 1) {
    const response = await api.asApp().requestJira(pathFor(page * 50), { headers: { Accept: 'application/json' } });
    const data = await readJson(response, 'Reading workflows');
    out.push(data);
    if (data?.isLast !== false && !data?.nextPage) break;
  }
  return out;
}

/**
 * Compare every transition into a Done-category (and In-progress-category)
 * status against the transitions that carry Preflight's validators.
 * Uses Jira's workflow search plus the transition-rule configuration API, which
 * lists rules created by this app. Returns rows for the admin page.
 */
export async function getWorkflowCoverage({ buildKey, doneKey }) {
  const searchPages = await pages((startAt) => route`/rest/api/3/workflows/search?expand=values.transitions&maxResults=50&startAt=${startAt}`);
  const rulePages = await pages((startAt) => route`/rest/api/3/workflow/rule/config?types=validator&expand=transition&maxResults=50&startAt=${startAt}`);

  // Which (workflow, transition) pairs carry which Preflight gate.
  const attached = new Map();
  for (const page of rulePages) {
    for (const wf of page?.values || []) {
      const name = wf.workflowId?.name || wf.workflowName;
      for (const v of wf.validators || []) {
        const stage = String(v.key).includes(doneKey) ? 'done' : String(v.key).includes(buildKey) ? 'build' : null;
        if (stage && v.transition?.id !== undefined) attached.set(`${name}|${v.transition.id}|${stage}`, true);
      }
    }
  }

  // Status category for each status reference. Only entries that carry a category count: a workflow's own
  // status list has none, and letting it overwrite the top-level list blanked every category (seen live).
  const category = new Map();
  const names = new Map();
  for (const page of searchPages) {
    for (const s of [...(page?.statuses || []), ...(page?.values || []).flatMap((w) => w.statuses || [])]) {
      const ref = s?.statusReference || s?.id;
      if (!ref) continue;
      const cat = s.statusCategory?.key || s.statusCategory;
      if (cat && !category.has(ref)) category.set(ref, String(cat));
      if (s.name && !names.has(ref)) names.set(ref, s.name);
    }
  }
  const stageOf = (ref) => {
    const cat = category.get(ref);
    if (cat) return DONE_CATEGORIES.has(cat) ? 'done' : PROGRESS_CATEGORIES.has(cat) ? 'build' : null;
    // Last resort when no category came back: the status name.
    const name = String(names.get(ref) || '').toLowerCase();
    return /^(done|closed|resolved|complete)/.test(name) ? 'done' : /in progress|in development|doing/.test(name) ? 'build' : null;
  };

  const rows = [];
  let workflows = 0;
  let transitions = 0;
  for (const page of searchPages) {
    for (const wf of page?.values || []) {
      workflows += 1;
      const name = wf.name || wf.id?.name;
      for (const t of wf.transitions || []) {
        transitions += 1;
        const to = t.toStatusReference || t.to?.statusReference || t.to?.id || t.to;
        const stage = stageOf(to);
        if (!stage) continue;
        const key = stage === 'done' ? doneKey : buildKey;
        const inline = JSON.stringify([t.validators, t.rules, t.conditions]).includes(key);
        rows.push({
          workflow: name,
          transition: t.name || String(t.id),
          stage,
          protected: inline || attached.has(`${name}|${t.id}|${stage}`),
        });
      }
    }
  }
  // Nothing recognised: describe what Jira sent (field names and counts only, no data) so it can be fixed.
  if (!rows.length) {
    const firstWf = searchPages[0]?.values?.[0] || {};
    rows.diagnostic = `Jira returned ${workflows} workflow(s), ${transitions} transition(s), ${category.size} status categories. ` +
      `Workflow fields: ${Object.keys(firstWf).join(', ') || 'none'}. Transition fields: ${Object.keys(firstWf.transitions?.[0] || {}).join(', ') || 'none'}. ` +
      `Top-level fields: ${Object.keys(searchPages[0] || {}).join(', ') || 'none'}.`;
  }
  return rows;
}
