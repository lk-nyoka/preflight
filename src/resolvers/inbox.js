/**
 * Resolver for the "Preflight reviews" global page: the approver's inbox.
 * Lists work items whose privacy review is open, split into "waiting for
 * approval" (answers complete) and "waiting on the team" (answers missing).
 * Entries are filtered to work items the signed-in user can see.
 */
import Resolver from '@forge/resolver';
import api, { route } from '@forge/api';
import { listQueue, getSettings } from '../store.js';
import { canCurrentUserApprove, approverMode } from '../service.js';
import { pendingRuleChanges, decideRuleChange, setApprovers, setPolicy, cancelReset, applyDueReset } from '../governance.js';

const resolver = new Resolver();

/** Keep only issues the current user can browse (JQL as the user does the permission check). */
async function visibleKeys(keys) {
  if (!keys.length) return new Set();
  const visible = new Set();
  for (let i = 0; i < keys.length; i += 50) {
    const chunk = keys.slice(i, i + 50);
    const response = await api.asUser().requestJira(route`/rest/api/3/search/jql`, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ jql: `key in (${chunk.join(',')})`, fields: ['key'], maxResults: 50 }),
    });
    if (!response.ok) {
      // One stale key can fail the whole query; fall back to checking keys one by one.
      for (const key of chunk) {
        const one = await api.asUser().requestJira(route`/rest/api/3/issue/${key}?fields=key`, { headers: { Accept: 'application/json' } });
        if (one.ok) visible.add(key);
      }
      continue;
    }
    const data = await response.json();
    for (const issue of data.issues || []) visible.add(issue.key);
  }
  return visible;
}

resolver.define('getInbox', async (req) => {
  try {
    await applyDueReset();
    const entries = await listQueue();
    const visible = await visibleKeys(entries.map((e) => e.key).filter((k) => /^[A-Z][A-Z0-9_]+-\d+$/.test(k)));
    const items = entries.filter((e) => visible.has(e.key)).sort((a, b) => b.updatedAt - a.updatedAt);
    const settings = await getSettings();
    const isApprover = settings.approverAccountIds.includes(req.context.accountId);
    return {
      isApprover,
      settings: isApprover ? { failClosed: settings.failClosed, separationOfDuties: settings.separationOfDuties, requireDeclaration: settings.requireDeclaration } : null,
      pendingReset: settings.pendingReset || null,
      ok: true,
      canApprove: await canCurrentUserApprove(req.context.accountId).catch(() => false),
      approverMode: await approverMode(),
      approvers: settings.approverAccountIds,
      ruleChanges: isApprover ? await pendingRuleChanges() : [],
      awaitingApproval: items.filter((i) => i.awaitingApproval),
      waitingOnTeam: items.filter((i) => !i.awaitingApproval && !i.exception && !i.bypassed),
      exceptions: items.filter((i) => i.exception),
      bypassed: items.filter((i) => i.bypassed),
    };
  } catch (error) {
    console.error('inbox.getInbox', error);
    return { ok: false, error: error.message };
  }
});

/** A named approver applies or rejects a proposed change to an active rule (governance.js enforces who). */
resolver.define('decideRuleChange', async (req) => {
  try {
    await decideRuleChange(req.payload.ruleId, req.payload.proposalId, req.payload.decision === 'apply' ? 'apply' : 'reject', req.context.accountId);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error.message };
  }
});

/** Approvers manage the approver list and policy here, so a non-admin Information Officer is not locked out. */
/** The inbox is open to every Jira user, so these require a named approver before anything else runs. */
async function requireNamedApprover(accountId) {
  const settings = await getSettings();
  if (!settings.approverAccountIds.includes(accountId)) throw new Error('Only a named Preflight approver can change this here. Jira admins use Jira settings > Apps > Preflight.');
}

for (const [name, fn] of Object.entries({
  setApprovers: (req) => setApprovers(req.payload.approverAccountIds, req.context.accountId),
  setPolicy: (req) => setPolicy(req.payload, req.context.accountId),
  cancelReset: (req) => cancelReset(req.context.accountId),
})) {
  resolver.define(name, async (req) => {
    try {
      await requireNamedApprover(req.context.accountId);
      await fn(req);
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  });
}

export const inboxHandler = resolver.getDefinitions();
