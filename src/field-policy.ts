import { ConfigError } from './errors.js';
import type { FieldPolicy } from './types/common.js';
import type { JiraFieldDef } from './types/jira.js';

function parseList(raw: string | undefined): string[] {
  return (raw ?? '')
    .split(',')
    .map(s => s.trim().toLowerCase())
    .filter(Boolean);
}

export function parseFieldPolicy(allowed?: string, blocked?: string): FieldPolicy | undefined {
  const allow = parseList(allowed);
  const block = parseList(blocked);
  return allow.length || block.length ? { allow, block } : undefined;
}

function matches(list: string[], field: Pick<JiraFieldDef, 'id' | 'name'>): boolean {
  return list.includes(field.id.toLowerCase()) || list.includes(field.name.toLowerCase());
}

export function isExplicitlyAllowed(policy: FieldPolicy | undefined, field: Pick<JiraFieldDef, 'id' | 'name'>): boolean {
  return !!policy && matches(policy.allow, field);
}

// Block-list applies to every field; allow-list only narrows custom fields so
// standard fields stay usable.
export function isFieldPermitted(
  policy: FieldPolicy | undefined,
  field: Pick<JiraFieldDef, 'id' | 'name' | 'custom'>,
): boolean {
  if (!policy) return true;
  if (matches(policy.block, field)) return false;
  if (field.custom && policy.allow.length > 0) return matches(policy.allow, field);
  return true;
}

// Same message for unknown and blocked fields so it reveals nothing.
export function fieldNotPermitted(ref: string): ConfigError {
  return new ConfigError(`Field "${ref}" is unknown or not permitted by the configured field policy.`);
}

function restrictedTerms(field: JiraFieldDef): string[] {
  return [field.id, field.name, ...field.clauseNames].map(t => t.toLowerCase());
}

/** Returns the restricted field a JQL query refers to, if any. */
export function findRestrictedJqlReference(jql: string, restricted: JiraFieldDef[]): JiraFieldDef | undefined {
  if (restricted.length === 0) return undefined;

  const byTerm = new Map<string, JiraFieldDef>();
  for (const field of restricted) {
    for (const term of restrictedTerms(field)) byTerm.set(term, field);
  }

  // Quoted field names ("Story Points") look like string values, so check both.
  const literal = /"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'/g;
  for (const m of jql.matchAll(literal)) {
    const hit = byTerm.get((m[1] ?? m[2] ?? '').trim().toLowerCase());
    if (hit) return hit;
  }

  const bare = jql.replace(literal, ' ');
  for (const m of bare.matchAll(/cf\s*\[\s*\d+\s*\]|[\w.]+/gi)) {
    const hit = byTerm.get(m[0].toLowerCase().replace(/\s+/g, ''));
    if (hit) return hit;
  }
  return undefined;
}
