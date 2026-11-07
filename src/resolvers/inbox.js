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
import { pendingRuleChanges, decideRuleChange } from '../governance.js';

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
    if (!response.ok) continue;
    const data = await response.json();
    for (const issue of data.issues || []) visible.add(issue.key);
  }
  return visible;
}

resolver.define('getInbox', async (req) => {
  try {
    const entries = await listQueue();
    const visible = await visibleKeys(entries.map((e) => e.key).filter((k) => /^[A-Z][A-Z0-9_]+-\d+$/.test(k)));
    const items = entries.filter((e) => visible.has(e.key)).sort((a, b) => b.updatedAt - a.updatedAt);
    const settings = await getSettings();
    return {
      ok: true,
      canApprove: await canCurrentUserApprove(req.context.accountId).catch(() => false),
      approverMode: await approverMode(),
      approvers: settings.approverAccountIds,
      ruleChanges: settings.approverAccountIds.includes(req.context.accountId) ? await pendingRuleChanges() : [],
      awaitingApproval: items.filter((i) => i.awaitingApproval),
      waitingOnTeam: items.filter((i) => !i.awaitingApproval),
    };
  } catch (error) {
    console.error('inbox.getInbox', error);
    return { ok: false, error: error.message };
  }
});

/** A named approver applies or rejects a proposed change to an active rule (governance.js enforces who). */
resolver.define('decideRuleChange', async (req) => {
  try {
    await decideRuleChange(req.payload.ruleId, req.payload.decision === 'apply' ? 'apply' : 'reject', req.context.accountId);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error.message };
  }
});

export const inboxHandler = resolver.getDefinitions();
