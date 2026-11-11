/**
 * The starter packs Preflight ships. Each pack is a set of editable rules plus
 * demo work items. An organisation activates the pack for its law (or both, for
 * a group operating in South Africa and the EU) and adapts it.
 */
import { POPIA_RULES, POPIA_PACK_ID, DEMO_ISSUES } from './popia.js';
import { GDPR_RULES, GDPR_PACK_ID, GDPR_DEMO_ISSUES } from './gdpr.js';

export const PACKS = {
  popia: { key: 'popia', name: 'POPIA (South Africa)', id: POPIA_PACK_ID, prefix: 'popia-starter', rules: POPIA_RULES, demo: DEMO_ISSUES },
  gdpr: { key: 'gdpr', name: 'GDPR (EU / EEA)', id: GDPR_PACK_ID, prefix: 'gdpr-starter', rules: GDPR_RULES, demo: GDPR_DEMO_ISSUES },
};

export function packFor(key) {
  const pack = PACKS[String(key || 'popia').toLowerCase()];
  if (!pack) throw new Error(`Unknown starter pack "${key}". Use one of: ${Object.keys(PACKS).join(', ')}.`);
  return pack;
}

/** Which shipped pack a stored rule came from (null for a custom rule). */
export function packOfRule(rule) {
  return Object.values(PACKS).find((p) => String(rule?.pack || '').startsWith(p.prefix)) || null;
}

export const isStarterRule = (rule) => Boolean(packOfRule(rule));
