/**
 * Rule validation shared by the admin editor and the Rovo "draft rule" action,
 * so a typo or a model's malformed output can never break enforcement.
 */
import { PreflightError } from './errors.js';
import { checkExamples } from './engine/evaluate.js';

const TYPES = ['answer', 'choice', 'link', 'approval'];
const STAGES = ['build', 'done'];

const split = (v) =>
  (Array.isArray(v) ? v : String(v || '').split(/[\n,]/)).map((s) => String(s).trim()).filter(Boolean).slice(0, 80);

const slug = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);

function parseJson(value, what) {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    throw new PreflightError(`${what} must be valid JSON.`);
  }
}

export function cleanRule(input, existing) {
  const id = String(input.id || existing?.id || '').trim();
  if (!/^[a-z0-9-]{3,60}$/.test(id)) throw new PreflightError('Rule id must be 3-60 lowercase letters, digits or dashes.');
  const title = String(input.title || '').trim().slice(0, 80);
  if (!title) throw new PreflightError('Rule needs a title.');

  const keywords = split(input.keywords ?? input.triggers?.keywords);
  const labels = split(input.labels ?? input.triggers?.labels);
  const exclude = split(input.exclude ?? input.triggers?.exclude);
  let contextual = parseJson(input.contextual ?? input.triggers?.contextual ?? [], 'Context triggers');
  if (!Array.isArray(contextual)) throw new PreflightError('Context triggers must be a list.');
  contextual = contextual
    .map((g) => ({ terms: split(g?.terms), with: split(g?.with) }))
    .filter((g) => g.terms.length && g.with.length)
    .slice(0, 20);
  if (!keywords.length && !labels.length && !contextual.length) {
    throw new PreflightError('Add at least one trigger phrase, context trigger or label.');
  }

  let requirements = parseJson(input.requirements, 'Requirements');
  if (!Array.isArray(requirements) || !requirements.length) throw new PreflightError('Add at least one requirement.');
  const seen = new Set();
  requirements = requirements.slice(0, 15).map((r, i) => {
    const reqId = String(r?.id || slug(r?.label) || `req-${i + 1}`);
    if (!r?.label || !TYPES.includes(r.type)) {
      throw new PreflightError(`Each requirement needs a label and a type (${TYPES.join(', ')}).`);
    }
    if (seen.has(reqId)) throw new PreflightError(`Two requirements share the id "${reqId}".`);
    seen.add(reqId);
    const options = Array.isArray(r.options) ? r.options.map(String).filter(Boolean) : split(r.options);
    if (r.type === 'choice' && options.length < 2) throw new PreflightError(`"${r.label}" is a choice, so it needs at least two options.`);
    return {
      id: reqId,
      label: String(r.label).slice(0, 120),
      type: r.type,
      stage: r.type === 'approval' ? 'build' : STAGES.includes(r.stage) ? r.stage : 'build',
      help: r.help ? String(r.help).slice(0, 300) : undefined,
      clause: r.clause ? String(r.clause).slice(0, 40) : undefined,
      options: r.type === 'choice' ? options : undefined,
      minWords: r.minWords ? Math.max(1, Math.min(50, Number(r.minWords))) : undefined,
      mustMention: r.type === 'answer' && r.mustMention ? split(r.mustMention).slice(0, 30) : undefined,
      mustMentionHint: r.type === 'answer' && r.mustMentionHint ? String(r.mustMentionHint).slice(0, 160) : undefined,
    };
  });

  const examples = {
    match: split(input.examplesMatch ?? input.examples?.match).slice(0, 20),
    ignore: split(input.examplesIgnore ?? input.examples?.ignore).slice(0, 20),
  };

  return {
    ...(existing || {}),
    id,
    title,
    clause: String(input.clause || '').trim().slice(0, 60) || 'Internal policy',
    policyRef: String(input.policyRef || '').trim().slice(0, 120) || null,
    summary: String(input.summary || '').trim().slice(0, 600),
    severity: input.severity === 'medium' ? 'medium' : 'high',
    triggers: { keywords, contextual, exclude, labels },
    requirements,
    examples,
    status: existing?.status || 'draft',
    updatedAt: Date.now(),
  };
}

/** Human-readable warnings when a rule's triggers break its own examples. */
export function exampleWarnings(rule) {
  const noApproval = (rule.requirements || []).some((r) => r.type === 'approval')
    ? [] : ['No approval step: work that matches this rule can start without anyone signing off.'];
  return noApproval.concat(checkExamples(rule).map((f) =>
    f.expected === 'match'
      ? `Should match but does not: "${f.text}"`
      : `Should not match but does ("${f.hits.join('", "')}"): "${f.text}"`,
  ));
}
