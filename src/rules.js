/**
 * Rule validation shared by the admin page and the Rovo "draft rule" action,
 * so a typo or a model's malformed output can never break enforcement.
 */
import { PreflightError } from './errors.js';

const TYPES = ['answer', 'choice', 'link', 'approval'];

/** Validate a rule coming from the editor so a typo cannot break enforcement. */
export function cleanRule(input, existing) {
  const id = String(input.id || existing?.id || '').trim();
  if (!/^[a-z0-9-]{3,60}$/.test(id)) throw new PreflightError('Rule id must be 3-60 lowercase letters, digits or dashes.');
  const title = String(input.title || '').trim();
  if (!title) throw new PreflightError('Rule needs a title.');
  const split = (v) =>
    (Array.isArray(v) ? v : String(v || '').split(/[\n,]/)).map((s) => String(s).trim()).filter(Boolean);
  const keywords = split(input.keywords ?? input.triggers?.keywords);
  const labels = split(input.labels ?? input.triggers?.labels);
  if (!keywords.length && !labels.length) throw new PreflightError('Add at least one trigger keyword or label.');

  let requirements = input.requirements;
  if (typeof requirements === 'string') {
    try {
      requirements = JSON.parse(requirements);
    } catch {
      throw new PreflightError('Requirements must be valid JSON.');
    }
  }
  if (!Array.isArray(requirements) || !requirements.length) throw new PreflightError('Add at least one requirement.');
  const seen = new Set();
  requirements = requirements.map((r) => {
    if (!r?.id || !r?.label || !TYPES.includes(r.type)) {
      throw new PreflightError(`Each requirement needs id, label and type (${TYPES.join(', ')}).`);
    }
    if (seen.has(r.id)) throw new PreflightError(`Duplicate requirement id "${r.id}".`);
    seen.add(r.id);
    if (r.type === 'choice' && (!Array.isArray(r.options) || r.options.length < 2)) {
      throw new PreflightError(`"${r.label}" is a choice, so it needs at least two options.`);
    }
    return { id: r.id, label: r.label, type: r.type, help: r.help, clause: r.clause, options: r.options, minLength: r.minLength };
  });

  return {
    ...(existing || {}),
    id,
    title,
    clause: String(input.clause || '').trim() || 'Internal policy',
    policyRef: String(input.policyRef || '').trim() || null,
    summary: String(input.summary || '').trim(),
    severity: input.severity === 'medium' ? 'medium' : 'high',
    triggers: { keywords, labels },
    requirements,
    status: existing?.status || 'draft',
    updatedAt: Date.now(),
  };
}

