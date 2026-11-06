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
 */
import { kvs } from '@forge/kvs';

const AUDIT_LIMIT = 100;

export const DEFAULT_SETTINGS = { approverAccountIds: [], failClosed: false };

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
  return { answers: {}, approvals: {}, manual: [], dismissals: {}, exception: null, audit: [] };
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
