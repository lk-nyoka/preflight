/**
 * Preflight rules engine.
 *
 * Pure: no Forge imports, no network, no storage. Given a work item's text,
 * the rules and the stored evidence record, it works out which rules apply and
 * what is still outstanding at each stage. Every Preflight surface (panel, both
 * workflow validators, triggers, Rovo actions, MCP tools) calls this function,
 * so they can never disagree.
 *
 * Two stages:
 *   build  - design-time review. Checked by the "review before build" gate
 *            (attach it to the transition into In Progress).
 *   done   - ship-time evidence. Checked, together with build, by the
 *            "evidence before done" gate (attach it to the transition into Done).
 *
 * The engine never decides that anything is "compliant". It decides whether the
 * organisation's own review steps have been completed.
 */

export const STAGES = ['build', 'done'];

/* ------------------------------------------------------------------ */
/* Text normalisation and matching                                     */
/* ------------------------------------------------------------------ */

/** Phrases that look like privacy triggers but almost never are, in Jira. Removed before matching. */
export const GLOBAL_EXCLUDES = [
  'race condition', 'race conditions', 'child issue', 'child issues', 'child page', 'child pages',
  'child process', 'child component', 'parent child', 'minor version', 'minor release', 'minor bug',
  'health check endpoint', 'health check endpoints', 'healthcheck', 'health endpoint', 'kubernetes health check', 'promo code', 'promo codes',
  'passport style', 'campaign dashboard', 'session id', 'request id', 'trace id', 'correlation id',
  'transaction id', 'build number', 'version number', 'order number', 'invoice number', 'ticket number',
  'issue number', 'line number', 'port number', 'phone mockup', 'phone layout',
];

/** Very small stemmer: plurals and a few suffixes, so "ID numbers" matches "id number". */
export function stem(word) {
  const w = word;
  if (w.length <= 3 && w !== 'ids') return w; // keep gps, sms, kyc, pii as they are
  if (/(oses|yses|eses)$/.test(w)) return `${w.slice(0, -2)}is`; // diagnoses -> diagnosis, analyses -> analysis
  if (w.length > 4 && w.endsWith('ies')) return `${w.slice(0, -3)}y`;
  if (w.length > 4 && /(sses|xes|zes|ches|shes)$/.test(w)) return w.slice(0, -2);
  if (w.endsWith('s') && !/(ss|us|is)$/.test(w)) return w.slice(0, -1);
  return w;
}

/** Lower-case, strip punctuation, stem each word, pad with spaces for whole-phrase matching. */
export function normalise(text) {
  const words = String(text || '')
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean)
    .map(stem);
  return ` ${words.join(' ')} `;
}

function stripPhrases(haystack, phrases) {
  let out = haystack;
  for (const p of phrases || []) {
    const needle = normalise(p);
    if (!needle.trim()) continue;
    while (out.includes(needle)) out = out.replace(needle, ' ');
  }
  return out;
}

/** Which of `phrases` occur (stem-aware, whole words) in an already-normalised haystack. */
function hitsIn(haystack, phrases) {
  const hits = [];
  const seen = new Set();
  for (const raw of phrases || []) {
    const needle = normalise(raw);
    // "patient" and "patients" normalise the same; report the phrase once.
    if (needle.trim() && !seen.has(needle) && haystack.includes(needle)) { hits.push(raw); seen.add(needle); }
  }
  return hits;
}

/** Public helper kept for tests and the "Test a rule" sandbox. */
export function findKeywordHits(text, keywords = [], excludes = []) {
  return hitsIn(stripPhrases(normalise(text), [...GLOBAL_EXCLUDES, ...excludes]), keywords);
}

/**
 * Match one rule's triggers against text.
 *   keywords    strong phrases that match on their own
 *   contextual  [{ terms: [...], with: [...] }]  a term only counts if a `with` phrase is also present
 *   exclude     phrases removed before matching (on top of GLOBAL_EXCLUDES)
 */
export function matchTriggers(text, triggers = {}) {
  const haystack = stripPhrases(normalise(text), [...GLOBAL_EXCLUDES, ...(triggers.exclude || [])]);
  const keywords = hitsIn(haystack, triggers.keywords);
  const contextual = [];
  for (const group of triggers.contextual || []) {
    const terms = hitsIn(haystack, group.terms);
    if (terms.length && hitsIn(haystack, group.with).length) contextual.push(...terms);
  }
  return { keywords: [...new Set([...keywords, ...contextual])] };
}

/**
 * Mask personal data in evidence snippets shown in the panel, comments, Rovo and
 * MCP: e-mail addresses and digit runs (ID, phone, account numbers).
 */
export function redact(text) {
  return String(text || '')
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[email removed]')
    .replace(/\+?\d[\d\s-]{5,}\d/g, '[number removed]');
}

/** A short fragment of the text around the first hit, shown as evidence (redacted). */
export function snippetAround(text, phrase, radius = 60) {
  const source = redact(String(text || '').replace(/\s+/g, ' '));
  const lower = source.toLowerCase();
  // Find the first word of the phrase, tolerating plurals.
  const first = String(phrase).toLowerCase().split(/\s+/)[0];
  let index = lower.indexOf(String(phrase).toLowerCase());
  if (index < 0) index = lower.indexOf(first);
  if (index < 0) return null;
  const start = Math.max(0, index - radius);
  const end = Math.min(source.length, index + String(phrase).length + radius);
  return `${start > 0 ? '…' : ''}${source.slice(start, end)}${end < source.length ? '…' : ''}`;
}

/* ------------------------------------------------------------------ */
/* Evidence checks                                                     */
/* ------------------------------------------------------------------ */

export const stageOf = (requirement) => (requirement.type === 'approval' ? 'build' : requirement.stage === 'done' ? 'done' : 'build');

/** Fingerprint of the build-stage answers an approval covers; editing them makes the approval stale. */
export function answersFingerprint(answersForRule = {}, rule = null) {
  const buildIds = rule
    ? new Set((rule.requirements || []).filter((r) => r.type !== 'approval' && stageOf(r) === 'build').map((r) => r.id))
    : null;
  const ordered = Object.keys(answersForRule)
    .filter((k) => !buildIds || buildIds.has(k))
    .sort()
    .map((k) => `${k}=${String(answersForRule[k]?.value ?? '').trim()}`)
    .join('|');
  // djb2; detects edits, not a security control.
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

/** Words and phrases that mean "no real answer yet", wherever they appear. */
const NOT_AN_ANSWER = /\b(tbd|tbc|todo|to be (decided|confirmed|determined)|not sure|unsure|no idea|don ?t know|dunno|(this|it|that) later|figure (it|this) out|decide later|later on|asap|placeholder|lorem ipsum|test(ing)? answer|quick brown fox|see above|same as above|n\/a)\b/i;
/** Keyboard rows and runs typed to get past a word count. */
const MASH = /^(asdf\w*|qwer\w*|zxcv\w*|uiop|hjkl|sdfg|wert|xcvb|dfgh|ghjk|fghj|yuio|tyui|vbnm|cvbn|azerty|abcd\w*|(\w)\2{2,}|blah|bla|lol|test|foo|bar|baz|xyz)$/i;

/**
 * Reject filler: placeholders anywhere in the text ("tbd", "not sure", "later"),
 * keyboard mash, repeated words, and answers that skip the one thing the question
 * asks for (requirement.mustMention: e.g. a retention answer must mention a time
 * or an event that ends it).
 */
export function answerQuality(value, requirement = {}) {
  const text = String(value || '').trim();
  const minWords = requirement.minWords ?? 4;
  const words = text.split(/\s+/).filter((w) => /[a-z0-9]/i.test(w));
  const lower = words.map((w) => w.toLowerCase().replace(/[^a-z0-9]/g, ''));
  if (/^(n\/?a|na|none|nothing|later|-+|\.+)$/i.test(text) || NOT_AN_ANSWER.test(text)) {
    return 'Give a real answer: placeholders like "TBD", "not sure" or "later" do not count';
  }
  if (new Set(text.toLowerCase().replace(/[^a-z]/g, '')).size < 5) return 'Give a real answer, not filler text';
  if (words.length < minWords) return `Needs at least ${minWords} words`;
  if (new Set(lower).size < Math.min(3, minWords)) return 'Give a real answer, not repeated words';
  const mashed = lower.filter((w) => MASH.test(w) || (w.length >= 4 && !/[aeiouy]/.test(w) && !/\d/.test(w)));
  if (mashed.length >= Math.max(2, Math.ceil(words.length / 3))) return 'Give a real answer, not keyboard filler';
  const must = requirement.mustMention || [];
  if (must.length) {
    const hay = normalise(text);
    if (!must.some((m) => (m.startsWith('/') ? new RegExp(m.slice(1, -1), 'i').test(text) : hay.includes(normalise(m))))) {
      return requirement.mustMentionHint || `Mention ${must.slice(0, 4).join(', ')}…`;
    }
  }
  return null;
}

function evaluateRequirement(rule, requirement, record, scope = []) {
  const answers = record.answers?.[rule.id] || {};
  if (requirement.type === 'approval') {
    const approval = record.approvals?.[rule.id];
    if (!approval) return { satisfied: false, reason: 'Waiting for an approver' };
    // Scope growth: the ticket now mentions something the approver did not see.
    // Approvals without a recorded scope covered nothing in particular, so any phrase counts as new.
    const grown = scope.filter((p) => !(approval.scope || []).includes(p));
    if (grown.length) return { satisfied: false, reason: `The work item now also mentions "${grown.join('", "')}"; re-approval needed` };
    if (rule.updatedAt && approval.at && rule.updatedAt > approval.at) {
      return { satisfied: false, reason: 'The rule changed after this was approved; re-approval needed' };
    }
    if (approval.fingerprint && approval.fingerprint !== answersFingerprint(answers, rule)) {
      return { satisfied: false, reason: 'Answers changed after approval; re-approval needed' };
    }
    return { satisfied: true, reason: null, by: approval.by, at: approval.at };
  }
  const value = String(answers[requirement.id]?.value ?? '').trim();
  if (!value) return { satisfied: false, reason: 'Not answered yet' };
  if (requirement.type === 'link' && !isUrl(value)) return { satisfied: false, reason: 'Must be a link (https://…)' };
  if (requirement.type === 'choice') {
    if (!requirement.options?.includes(value)) return { satisfied: false, reason: 'Pick one of the listed options' };
  } else if (requirement.type === 'answer') {
    const problem = answerQuality(value, requirement);
    if (problem) return { satisfied: false, reason: problem };
  }
  return { satisfied: true, reason: null, by: answers[requirement.id]?.by, at: answers[requirement.id]?.at };
}

/* ------------------------------------------------------------------ */
/* Main evaluation                                                     */
/* ------------------------------------------------------------------ */

/**
 * @param {{ text: string, labels?: string[] }} workItem
 * @param {Array} rules     only status === 'active' are enforced
 * @param {object} record   evidence record for the work item
 * @param {object} [opts]   { now, declarationRuleId, requireDeclaration }
 * @returns evaluation with overall `status` (done-gate view) and per-stage results
 */
export function evaluate(workItem, rules = [], record = {}, opts = {}) {
  const now = opts.now ?? Date.now();
  const text = workItem?.text || '';
  const labels = (workItem?.labels || []).map((l) => String(l).toLowerCase());
  const manual = new Set(record.manual || []);
  const declaration = record.declaration?.value || null;
  if ((declaration === 'yes' || declaration === 'unsure') && opts.declarationRuleId) manual.add(opts.declarationRuleId);
  // Sticky: once a rule matched, rewording the ticket does not remove it. Only an approver's dismissal does.
  const sticky = new Set(Object.keys(record.matched || {}));
  const applicable = [];
  const dismissed = [];

  for (const rule of rules) {
    if (rule.status !== 'active') continue;
    const { keywords } = matchTriggers(text, rule.triggers);
    const labelHits = (rule.triggers?.labels || []).filter((l) => labels.includes(String(l).toLowerCase()));
    const flagged = manual.has(rule.id);
    const previously = sticky.has(rule.id);
    if (!keywords.length && !labelHits.length && !flagged && !previously) continue;

    const match = {
      ruleId: rule.id,
      title: rule.title,
      clause: rule.clause,
      policyRef: rule.policyRef || null,
      summary: rule.summary,
      severity: rule.severity || 'high',
      ruleVersion: rule.updatedAt || null,
      why: {
        keywords,
        labels: labelHits,
        manual: flagged,
        declared: flagged && rule.id === opts.declarationRuleId && Boolean(declaration),
        sticky: previously && !keywords.length && !labelHits.length && !flagged,
        firstMatched: record.matched?.[rule.id] || null,
        snippet: keywords.length ? snippetAround(text, keywords[0]) : null,
      },
    };

    const dismissal = record.dismissals?.[rule.id];
    // A dismissal covers only the phrases it was given for. New phrases for the rule re-open it.
    const newSinceDismissal = dismissal ? [...keywords, ...labelHits].filter((p) => !(dismissal.phrases || []).includes(p)) : [];
    if (dismissal && !newSinceDismissal.length) {
      dismissed.push({ ...match, dismissal });
      continue;
    }
    if (dismissal) match.why.reopened = newSinceDismissal;

    const scope = [...new Set([...keywords, ...labelHits, ...(record.matched?.[rule.id]?.phrases || [])])].sort();
    match.scope = scope;
    match.requirements = (rule.requirements || []).map((req) => ({
      id: req.id,
      label: req.label,
      type: req.type,
      stage: stageOf(req),
      help: req.help || null,
      options: req.options || null,
      clause: req.clause || null,
      ...evaluateRequirement(rule, req, record, scope),
    }));
    match.buildSatisfied = match.requirements.filter((r) => r.stage === 'build').every((r) => r.satisfied);
    match.satisfied = match.requirements.every((r) => r.satisfied);
    applicable.push(match);
  }

  const open = applicable.flatMap((m) =>
    m.requirements.filter((r) => !r.satisfied).map((r) => ({ ...r, ruleId: m.ruleId, ruleTitle: m.title, ruleClause: m.clause })),
  );
  const openBuild = open.filter((o) => o.stage === 'build');

  const exceptionActive = Boolean(record.exception) && (!record.exception.expiresAt || record.exception.expiresAt > now);
  const exceptionExpired = Boolean(record.exception) && !exceptionActive;
  // An exception waives only the rules it was granted for (older records without a list waive nothing new).
  // It also covers only the phrases each rule matched when it was granted: new wording re-opens that rule.
  const waived = new Set();
  if (exceptionActive) {
    for (const id of record.exception.ruleIds || []) {
      const pinned = record.exception.scopes?.[id];
      const match = applicable.find((m) => m.ruleId === id);
      if (!pinned || !match || match.scope.every((p) => pinned.includes(p))) waived.add(id);
    }
  }
  const needsDeclaration = Boolean(opts.requireDeclaration) && !declaration && !applicable.length;
  // "Yes"/"Unsure" with no active declaration rule must not silently pass.
  const declarationRuleMissing = (declaration === 'yes' || declaration === 'unsure') && !opts.declarationRuleId && !applicable.length;

  const statusFor = (openItems) => {
    if (needsDeclaration || declarationRuleMissing) return 'blocked';
    if (!applicable.length) return 'not-applicable';
    const unwaived = openItems.filter((o) => !waived.has(o.ruleId));
    if (!openItems.length) return 'clear';
    return unwaived.length ? 'blocked' : 'exception';
  };
  const done = statusFor(open);
  const build = statusFor(openBuild);

  const awaiting = applicable.some((m) => m.requirements.some((r) => r.type === 'approval' && !r.satisfied) &&
    m.requirements.filter((r) => r.type !== 'approval' && r.stage === 'build').every((r) => r.satisfied));

  return {
    status: done,
    stages: {
      build: { status: build, open: openBuild, needsDeclaration, declarationRuleMissing, summary: describe(build, applicable, openBuild.filter((o) => !waived.has(o.ruleId)), 'build', needsDeclaration, declarationRuleMissing) },
      done: { status: done, open, needsDeclaration, declarationRuleMissing, summary: describe(done, applicable, open.filter((o) => !waived.has(o.ruleId)), 'done', needsDeclaration, declarationRuleMissing) },
    },
    applicable,
    dismissed,
    open,
    openCount: open.length,
    awaitingApproval: awaiting,
    exceptionExpired,
    declaration,
    summary: describe(done, applicable, open, 'done') + (exceptionExpired && done === 'blocked' ? ' The earlier exception has expired.' : ''),
  };
}

/** One human sentence for validator errors, comments and agent replies. */
export function describe(status, applicable, open, stage = 'done', needsDeclaration = false, declarationRuleMissing = false) {
  if (declarationRuleMissing) return 'This work item was declared as affecting personal information, but no active rule handles declarations. Ask a Jira admin to activate "Contact details and location" (or another declaration rule).';
  if (needsDeclaration) return 'Before work starts, say whether this change affects personal information (Yes / No / Unsure) in the Preflight panel.';
  if (status === 'not-applicable') return 'No configured privacy rule matched this work item.';
  if (status === 'clear') {
    return stage === 'build'
      ? 'Privacy review complete: work can start.'
      : `All ${applicable.length} applicable privacy rule(s) have their evidence and approvals.`;
  }
  if (status === 'exception') return 'An approver recorded an exception for this work item.';
  const byRule = {};
  for (const item of open) {
    byRule[item.ruleTitle] = byRule[item.ruleTitle] || { clause: item.ruleClause, items: [] };
    byRule[item.ruleTitle].items.push(item.label);
  }
  const parts = Object.entries(byRule).map(([title, v]) => {
    const approval = v.items.some((l) => /approval/i.test(l));
    const answers = v.items.filter((l) => !/approval/i.test(l));
    const bits = [];
    if (answers.length) bits.push(answers.length <= 2 ? answers.join(', ') : `${answers.length} questions`);
    if (approval) bits.push('approval');
    return `${title} (${v.clause}): ${bits.join(' + ')}`;
  });
  const lead = stage === 'build' ? 'Privacy review needed before work starts.' : `${open.length} privacy requirement(s) still open.`;
  return `${lead} ${parts.join('; ')}.`;
}

/**
 * Run a rule's own examples. Used by unit tests and by the admin editor, which
 * warns when an edit breaks an example.
 */
export function checkExamples(rule) {
  const failures = [];
  for (const t of rule.examples?.match || []) {
    if (!matchTriggers(t, rule.triggers).keywords.length) failures.push({ text: t, expected: 'match' });
  }
  for (const t of rule.examples?.ignore || []) {
    const hits = matchTriggers(t, rule.triggers).keywords;
    if (hits.length) failures.push({ text: t, expected: 'no match', hits });
  }
  return failures;
}
