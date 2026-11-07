/**
 * Preflight rules engine.
 *
 * This file is deliberately pure: no Forge imports, no network, no storage.
 * Given the text of a work item, the active rules and the stored evidence
 * record for that work item, it works out which rules apply and what is
 * still missing. Every Preflight surface (issue panel, workflow validator,
 * trigger, Rovo actions, MCP tools) calls this same function, so they can
 * never disagree about whether a ticket is blocked.
 *
 * The engine does not decide whether anything is "compliant". It decides
 * whether the organisation's own review steps have been completed.
 */

/** Lower-case, strip punctuation and collapse whitespace so phrase matching is stable. */
export function normalise(text) {
  return ` ${String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()} `;
}

/**
 * Find which trigger phrases occur in the text. Phrases match on word
 * boundaries ("id number" matches "SA ID number" but "paid" does not match "id").
 */
export function findKeywordHits(text, keywords = []) {
  const haystack = normalise(text);
  const hits = [];
  for (const raw of keywords) {
    const needle = normalise(raw);
    if (needle.trim() && haystack.includes(needle)) hits.push(raw);
  }
  return hits;
}

/**
 * Mask long digit runs (ID numbers, phone and account numbers) so evidence
 * snippets shown in the panel, comments and to Rovo/MCP never carry the
 * personal information itself. Data minimisation inside the privacy tool.
 */
export function redact(text) {
  return String(text || '').replace(/\+?\d[\d\s-]{5,}\d/g, '[number removed]');
}

/** A short, readable fragment of the text around the first hit, shown as evidence. */
export function snippetAround(text, phrase, radius = 60) {
  const source = redact(String(text || '').replace(/\s+/g, ' '));
  const index = source.toLowerCase().indexOf(String(phrase).toLowerCase());
  if (index < 0) return null;
  const start = Math.max(0, index - radius);
  const end = Math.min(source.length, index + phrase.length + radius);
  return `${start > 0 ? '…' : ''}${source.slice(start, end)}${end < source.length ? '…' : ''}`;
}

/** Stable fingerprint of the answers to a rule, so an approval goes stale if answers change. */
export function answersFingerprint(answersForRule = {}) {
  const ordered = Object.keys(answersForRule)
    .sort()
    .map((k) => `${k}=${String(answersForRule[k]?.value ?? '').trim()}`)
    .join('|');
  // Small non-cryptographic hash (djb2); this detects edits, it is not a security control.
  let hash = 5381;
  for (let i = 0; i < ordered.length; i += 1) hash = ((hash << 5) + hash + ordered.charCodeAt(i)) >>> 0;
  return hash.toString(16);
}

function isUrl(value) {
  try {
    const url = new URL(String(value).trim());
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
}

/**
 * Evaluate one requirement of one rule.
 * Returns { satisfied, reason } where reason explains a failure in plain words.
 */
function evaluateRequirement(rule, requirement, record) {
  const answers = record.answers?.[rule.id] || {};
  if (requirement.type === 'approval') {
    const approval = record.approvals?.[rule.id];
    if (!approval) return { satisfied: false, reason: 'Waiting for an approver' };
    if (rule.updatedAt && approval.at && rule.updatedAt > approval.at) {
      return { satisfied: false, reason: 'The rule changed after this was approved; re-approval needed' };
    }
    if (approval.fingerprint && approval.fingerprint !== answersFingerprint(answers)) {
      return { satisfied: false, reason: 'Answers changed after approval; re-approval needed' };
    }
    return { satisfied: true, reason: null, by: approval.by, at: approval.at };
  }

  const value = String(answers[requirement.id]?.value ?? '').trim();
  if (!value) return { satisfied: false, reason: 'Not answered yet' };
  if (requirement.type === 'link' && !isUrl(value)) {
    return { satisfied: false, reason: 'Must be a link (https://…)' };
  }
  if (requirement.type === 'choice' && requirement.options && !requirement.options.includes(value)) {
    return { satisfied: false, reason: 'Pick one of the listed options' };
  }
  if (requirement.type === 'answer' && value.length < (requirement.minLength || 10)) {
    return { satisfied: false, reason: `Needs at least ${requirement.minLength || 10} characters` };
  }
  return { satisfied: true, reason: null, by: answers[requirement.id]?.by, at: answers[requirement.id]?.at };
}

/**
 * Main entry point.
 *
 * @param {{ text: string, labels?: string[] }} workItem  summary + description (+ labels)
 * @param {Array} rules   rule objects (only status === 'active' are enforced)
 * @param {object} record evidence record stored for this work item
 * @returns {{ status, applicable, dismissed, openCount, summary }}
 *   status is one of: 'not-applicable' | 'blocked' | 'clear' | 'exception'
 */
export function evaluate(workItem, rules = [], record = {}, now = Date.now()) {
  const text = workItem?.text || '';
  const labels = (workItem?.labels || []).map((l) => String(l).toLowerCase());
  const manual = new Set(record.manual || []);
  // Once a rule has matched a work item it stays applicable, even if the text is
  // later reworded, until an approver dismisses it. Editing out "ID number" does
  // not open the gate.
  const sticky = new Set(Object.keys(record.matched || {}));
  const applicable = [];
  const dismissed = [];

  for (const rule of rules) {
    if (rule.status !== 'active') continue;
    const keywordHits = findKeywordHits(text, rule.triggers?.keywords);
    const labelHits = (rule.triggers?.labels || []).filter((l) => labels.includes(String(l).toLowerCase()));
    const flaggedManually = manual.has(rule.id);
    const previouslyMatched = sticky.has(rule.id);
    if (!keywordHits.length && !labelHits.length && !flaggedManually && !previouslyMatched) continue;

    const match = {
      ruleId: rule.id,
      title: rule.title,
      clause: rule.clause,
      policyRef: rule.policyRef || null,
      summary: rule.summary,
      severity: rule.severity || 'high',
      why: {
        keywords: keywordHits,
        labels: labelHits,
        manual: flaggedManually,
        sticky: previouslyMatched && !keywordHits.length && !labelHits.length && !flaggedManually,
        firstMatched: record.matched?.[rule.id] || null,
        snippet: keywordHits.length ? snippetAround(text, keywordHits[0]) : null,
      },
    };

    const dismissal = record.dismissals?.[rule.id];
    if (dismissal) {
      dismissed.push({ ...match, dismissal });
      continue;
    }

    match.requirements = (rule.requirements || []).map((req) => ({
      id: req.id,
      label: req.label,
      type: req.type,
      help: req.help || null,
      options: req.options || null,
      clause: req.clause || null,
      ...evaluateRequirement(rule, req, record),
    }));
    match.satisfied = match.requirements.every((r) => r.satisfied);
    applicable.push(match);
  }

  const open = applicable.flatMap((m) =>
    m.requirements.filter((r) => !r.satisfied).map((r) => ({ ...r, ruleId: m.ruleId, ruleTitle: m.title, ruleClause: m.clause })),
  );

  const exceptionActive = Boolean(record.exception) && (!record.exception.expiresAt || record.exception.expiresAt > now);
  const exceptionExpired = Boolean(record.exception) && !exceptionActive;

  let status = 'not-applicable';
  if (applicable.length) status = open.length ? 'blocked' : 'clear';
  if (status === 'blocked' && exceptionActive) status = 'exception';

  return {
    status,
    exceptionExpired,
    applicable,
    dismissed,
    open,
    openCount: open.length,
    summary: describe(status, applicable, open) + (exceptionExpired && status === 'blocked' ? ' The earlier exception has expired.' : ''),
  };
}

/** One human sentence for the validator error, comments and agent replies. */
export function describe(status, applicable, open) {
  if (status === 'not-applicable') return 'No configured privacy rule matched this work item.';
  if (status === 'clear') return `All ${applicable.length} applicable privacy rule(s) have their evidence and approvals.`;
  if (status === 'exception') return 'An approver recorded an exception for this work item.';
  const byRule = {};
  for (const item of open) {
    byRule[item.ruleTitle] = byRule[item.ruleTitle] || { clause: item.ruleClause, items: [] };
    byRule[item.ruleTitle].items.push(item.label);
  }
  const parts = Object.entries(byRule).map(([title, v]) => `${title} (${v.clause}): ${v.items.join(', ')}`);
  return `${open.length} privacy requirement(s) still open. ${parts.join('; ')}.`;
}
