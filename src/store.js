/**
 * Storage layer (Forge Key-Value Store).
 *
 * Everything that decides whether work may move lives in app storage, written
 * only by Preflight's server-side functions. Nothing authoritative is kept in
 * Jira issue properties, which users with edit permission can change via REST.
 *
 * Keys
 *   rules                     array of rule objects
 *   settings                  approvers, failure mode, declaration settings
 *   rec:<issueId>             evidence record for one work item
 *   queue:<issueId>           approvals-inbox entry (only while review is open)
 *   gates                     { [projectKey]: { lastRunAt, lastIssueKey, stages } } validator heartbeat
 *   audit:<scope>:<seq>       WRITE-ONCE audit events (scope = issue id, or "admin")
 *   lock:<issueId>            short-lived mutex (10 s TTL) around record updates
 */
import { kvs, WhereConditions } from '@forge/kvs';

export const DEFAULT_SETTINGS = {
  approverAccountIds: [],
  // Fail closed: Preflight is a control. If it cannot evaluate, the transition is held.
  failClosed: true,
  separationOfDuties: false,
  // When on, the build gate also asks for a Yes/No/Unsure declaration on work no rule matched.
  requireDeclaration: false,
};

/* ---------------- rules and settings ---------------- */

export async function getRules() {
  return (await kvs.get('rules')) || [];
}

export async function saveRules(rules) {
  await kvs.set('rules', rules);
  return rules;
}

export async function getSettings() {
  return { ...DEFAULT_SETTINGS, ...((await kvs.get('settings')) || {}) };
}

export async function saveSettings(patch) {
  const next = { ...(await getSettings()), ...patch };
  await kvs.set('settings', next);
  return next;
}

/* ---------------- evidence records ---------------- */

export function emptyRecord() {
  return { answers: {}, drafts: {}, approvals: {}, manual: [], matched: {}, dismissals: {}, exception: null, declaration: null };
}

export async function getRecord(issueId) {
  return { ...emptyRecord(), ...((await kvs.get(`rec:${issueId}`)) || {}) };
}

export async function deleteRecord(issueId) {
  await kvs.delete(`rec:${issueId}`);
  await kvs.delete(`queue:${issueId}`);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Run `fn` while holding a per-issue lock, so two people (or the validator and
 * a person) saving at the same moment cannot overwrite each other's changes.
 * The lock expires after 10 seconds even if a function crashes.
 */
export async function withLock(issueId, fn, { attempts = 8 } = {}) {
  const key = `lock:${issueId}`;
  for (let i = 0; i < attempts; i += 1) {
    let acquired = false;
    try {
      await kvs.set(key, { at: Date.now() }, { keyPolicy: 'FAIL_IF_EXISTS', ttl: { value: 10, unit: 'SECONDS' } });
      acquired = true;
    } catch {
      await sleep(120 + i * 80);
    }
    if (acquired) {
      try {
        return await fn();
      } finally {
        await kvs.delete(key).catch(() => {});
      }
    }
  }
  const error = new Error('Someone else is updating this work item. Try again in a moment.');
  error.code = 'BUSY';
  throw error;
}

/**
 * Read-modify-write a record under the lock and write an audit event.
 * `mutate` receives the record and changes it in place.
 */
export async function updateRecord(issueId, actor, event, mutate, details = {}) {
  return withLock(issueId, async () => {
    const record = await getRecord(issueId);
    mutate(record);
    await kvs.set(`rec:${issueId}`, record);
    await appendAudit(issueId, { by: actor || 'app', event, ...details });
    return record;
  });
}

/* ---------------- write-once audit ---------------- */

/** Sortable, unique sequence id: 13-char base-36 timestamp plus random suffix. */
function sequenceId() {
  return `${Date.now().toString(36).padStart(10, '0')}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Append an audit event. Each event is its own key written with
 * FAIL_IF_EXISTS, and Preflight has no code path that updates or deletes an
 * audit key, so history cannot be rewritten through the app.
 */
export async function appendAudit(scope, entry) {
  const event = { at: Date.now(), via: 'panel', ...entry };
  for (let i = 0; i < 3; i += 1) {
    try {
      await kvs.set(`audit:${scope}:${sequenceId()}`, event, { keyPolicy: 'FAIL_IF_EXISTS' });
      return event;
    } catch (error) {
      if (i === 2) throw error;
    }
  }
  return event;
}

/** Newest-first audit events for a scope (issue id or "admin"). */
export async function listAudit(scope, { limit = 50, maxPages = 10 } = {}) {
  const results = [];
  let cursor;
  for (let page = 0; page < maxPages; page += 1) {
    let q = kvs.query().where('key', WhereConditions.beginsWith(`audit:${scope}:`)).limit(100);
    if (cursor) q = q.cursor(cursor);
    const { results: batch = [], nextCursor } = await q.getMany();
    results.push(...batch);
    if (!nextCursor) break;
    cursor = nextCursor;
  }
  return results
    .sort((a, b) => (a.key < b.key ? 1 : -1))
    .slice(0, limit)
    .map((r) => r.value);
}

/* ---------------- approvals inbox index ---------------- */

export async function setQueueEntry(issueId, entry) {
  if (entry) await kvs.set(`queue:${issueId}`, entry);
  else await kvs.delete(`queue:${issueId}`);
}

export async function listQueue({ maxPages = 10 } = {}) {
  const out = [];
  let cursor;
  for (let page = 0; page < maxPages; page += 1) {
    let q = kvs.query().where('key', WhereConditions.beginsWith('queue:')).limit(100);
    if (cursor) q = q.cursor(cursor);
    const { results = [], nextCursor } = await q.getMany();
    out.push(...results.map((r) => r.value));
    if (!nextCursor) break;
    cursor = nextCursor;
  }
  return out;
}

/* ---------------- gate heartbeat ---------------- */

/** Record that a gate ran in a project (at most one write per project, stage and hour). */
export async function markGateSeen(projectKey, issueKey, stage) {
  if (!projectKey) return;
  const gates = (await kvs.get('gates')) || {};
  const current = gates[projectKey] || { stages: {} };
  if (current.stages?.[stage] > Date.now() - 60 * 60 * 1000) return;
  gates[projectKey] = { lastRunAt: Date.now(), lastIssueKey: issueKey, stages: { ...(current.stages || {}), [stage]: Date.now() } };
  await kvs.set('gates', gates);
}

export async function getGates() {
  return (await kvs.get('gates')) || {};
}
