/**
 * Storage layer (Forge Key-Value Store).
 *
 * Everything that decides whether a ticket may move is stored here, in app
 * storage, NOT in Jira issue properties. Issue properties can be edited by
 * anyone with edit permission through the REST API, so evidence and approvals
 * kept there could be forged. App storage is only writable by this app.
 *
 * Keys:
 *   rules          -> array of rule objects (small; one key keeps updates atomic)
 *   settings       -> { approverAccountIds: [], failClosed: false }
 *   rec:<issueId>  -> evidence record for one work item
 *   gates          -> { [projectKey]: { lastRunAt, lastIssueKey } } validator heartbeat
 */
import { kvs } from '@forge/kvs';

const AUDIT_LIMIT = 100;

// Fail closed by default: Preflight is a control, so if it cannot evaluate a work
// item it refuses the transition (with a clear message) rather than letting it through.
export const DEFAULT_SETTINGS = { approverAccountIds: [], failClosed: true, separationOfDuties: false };

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

export function emptyRecord() {
  return { answers: {}, approvals: {}, manual: [], matched: {}, dismissals: {}, exception: null, audit: [] };
}

export async function getRecord(issueId) {
  return { ...emptyRecord(), ...((await kvs.get(`rec:${issueId}`)) || {}) };
}

/**
 * Read-modify-write a record and append an audit entry in the same write.
 * `mutate` receives the record and changes it in place.
 */
export async function updateRecord(issueId, actor, event, mutate) {
  const record = await getRecord(issueId);
  mutate(record);
  record.audit = [{ at: Date.now(), by: actor || 'app', event }, ...(record.audit || [])].slice(0, AUDIT_LIMIT);
  await kvs.set(`rec:${issueId}`, record);
  return record;
}

/** Record that the workflow validator ran in a project, so the UI can tell whether the gate is attached. */
export async function markGateSeen(projectKey, issueKey) {
  if (!projectKey) return;
  const gates = (await kvs.get('gates')) || {};
  // At most one write per project per hour keeps the validator fast.
  if (gates[projectKey]?.lastRunAt > Date.now() - 60 * 60 * 1000) return;
  gates[projectKey] = { lastRunAt: Date.now(), lastIssueKey: issueKey };
  await kvs.set('gates', gates);
}

export async function getGates() {
  return (await kvs.get('gates')) || {};
}
