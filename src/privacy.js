/**
 * Personal data reporting (Atlassian's user privacy guidelines).
 *
 * Preflight stores Atlassian account IDs: who answered, approved, dismissed,
 * declared or changed a rule, and who the named approvers are. Once a week it
 * reports those account IDs to Atlassian's personal data reporting API. For
 * every account Atlassian says is CLOSED, Preflight replaces the ID with
 * "closed-account" everywhere it is stored, INCLUDING the audit history.
 *
 * That anonymisation is the one change Preflight ever makes to an audit event
 * after it is written, because erasing a closed account is a legal duty that
 * outranks keeping the record verbatim. What happened, and when, stays; only
 * who did it becomes "closed-account". Each run is itself audited, without IDs.
 *
 * "updated" accounts need no action: Preflight stores no names, e-mails or
 * avatars, and shows them live from Jira.
 */
import { privacy } from '@forge/api';
import { kvs, WhereConditions } from '@forge/kvs';
import { appendAudit } from './store.js';

export const CLOSED = 'closed-account';

/** Fields that hold an Atlassian account ID (a string or a list of them). */
const ACCOUNT_FIELDS = new Set([
  'by', 'actor', 'accountId', 'activatedBy', 'confirmedBy', 'resetBy', 'raisedBy', 'approverAccountIds',
  'reporterAccountId', 'assigneeAccountId', 'requestedBy', 'decidedBy',
]);
const NOT_PEOPLE = new Set(['app', 'engine', 'unknown', 'unknown-user', CLOSED, '']);
const isPerson = (v) => typeof v === 'string' && !NOT_PEOPLE.has(v);

const PREFIXES = ['rec:', 'audit:', 'queue:'];
const SINGLE_KEYS = ['rules', 'settings'];

/** Every stored value that could hold account IDs, as [key, value] pairs. */
async function allStored() {
  const out = [];
  for (const key of SINGLE_KEYS) {
    const value = await kvs.get(key);
    if (value !== undefined && value !== null) out.push([key, value]);
  }
  for (const prefix of PREFIXES) {
    let cursor;
    for (let page = 0; page < 200; page += 1) {
      let q = kvs.query().where('key', WhereConditions.beginsWith(prefix)).limit(100);
      if (cursor) q = q.cursor(cursor);
      const { results = [], nextCursor } = await q.getMany();
      for (const r of results) out.push([r.key, r.value]);
      if (!nextCursor || !results.length) break;
      cursor = nextCursor;
    }
  }
  return out;
}

/** Walk a stored value; call found(accountId, at) for every account ID with the nearest timestamp. */
function walk(value, found, at = null) {
  if (Array.isArray(value)) {
    for (const item of value) walk(item, found, at);
    return;
  }
  if (!value || typeof value !== 'object') return;
  const here = typeof value.at === 'number' ? value.at : typeof value.updatedAt === 'number' ? value.updatedAt : at;
  for (const [k, v] of Object.entries(value)) {
    if (ACCOUNT_FIELDS.has(k)) {
      for (const id of Array.isArray(v) ? v : [v]) if (isPerson(id)) found(id, here);
    } else if (v && typeof v === 'object') {
      walk(v, found, here);
    }
  }
}

/** The account IDs Preflight stores, each with the last time Preflight wrote data for it. */
export function collectAccounts(stored) {
  const latest = new Map();
  for (const [, value] of stored) {
    walk(value, (id, at) => {
      const t = at || Date.now();
      if (!latest.has(id) || latest.get(id) < t) latest.set(id, t);
    });
  }
  return [...latest].map(([accountId, t]) => ({ accountId, updatedAt: new Date(t).toISOString() }));
}

/** A copy of value with every closed account replaced (and dropped from approver lists). */
export function anonymise(value, closed) {
  if (Array.isArray(value)) return value.map((v) => anonymise(v, closed));
  if (!value || typeof value !== 'object') return value;
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    if (ACCOUNT_FIELDS.has(k)) {
      if (k === 'approverAccountIds') out[k] = (v || []).filter((id) => !closed.has(id));
      else if (Array.isArray(v)) out[k] = [...new Set(v.map((id) => (closed.has(id) ? CLOSED : id)))];
      else out[k] = closed.has(v) ? CLOSED : v;
    } else {
      out[k] = v && typeof v === 'object' ? anonymise(v, closed) : v;
    }
  }
  return out;
}

/** Weekly: report stored account IDs to Atlassian and anonymise closed accounts. */
export async function reportAndErase({ report = privacy.reportPersonalData } = {}) {
  const stored = await allStored();
  const accounts = collectAccounts(stored);
  const updates = accounts.length ? await report(accounts) : [];
  const closed = new Set((updates || []).filter((u) => u.status === 'closed').map((u) => u.accountId));
  let changed = 0;
  if (closed.size) {
    for (const [key, value] of stored) {
      const next = anonymise(value, closed);
      if (JSON.stringify(next) !== JSON.stringify(value)) {
        await kvs.set(key, next);
        changed += 1;
      }
    }
    await appendAudit('admin', {
      by: 'app',
      via: 'engine',
      action: 'privacy.anonymised',
      event: `Anonymised ${closed.size} closed Atlassian account(s) in ${changed} stored item(s), as Atlassian's privacy rules require. The events remain; who did them now reads "closed-account".`,
    });
  }
  return { reported: accounts.length, closed: closed.size, changed };
}
