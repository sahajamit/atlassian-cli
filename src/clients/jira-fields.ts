import { ConfigError } from '../errors.js';
import { adfToMarkdown } from '../preprocessing/adf-to-text.js';
import { textToAdf } from '../preprocessing/text-to-adf.js';
import type { DeploymentType } from '../types/common.js';
import type { JiraFieldDef } from '../types/jira.js';

const SPRINT_TYPE = 'com.pyxis.greenhopper.jira:gh-sprint';

export function isSprintField(def: JiraFieldDef): boolean {
  return def.schema?.custom === SPRINT_TYPE;
}

export function normalizeFieldDef(raw: Record<string, unknown>): JiraFieldDef {
  const schema = raw.schema as Record<string, unknown> | undefined;
  return {
    id: String(raw.id ?? ''),
    name: String(raw.name ?? ''),
    custom: raw.custom === true,
    clauseNames: Array.isArray(raw.clauseNames) ? raw.clauseNames.map(String) : [],
    schema: schema
      ? {
          type: schema.type as string | undefined,
          items: schema.items as string | undefined,
          custom: schema.custom as string | undefined,
        }
      : undefined,
  };
}

export function findFieldDefs(catalog: JiraFieldDef[], ref: string): JiraFieldDef[] {
  const needle = ref.trim().toLowerCase();
  return catalog.filter(f => f.id.toLowerCase() === needle || f.name.toLowerCase() === needle);
}

// ── Read ─────────────────────────────────────────────

// Data Center returns sprints as "com.atlassian...Sprint@1a2b[id=1,name=Sprint 1,state=ACTIVE,...]".
function parseLegacySprint(value: string): Record<string, unknown> {
  const body = value.match(/\[(.*)\]\s*$/s)?.[1] ?? '';
  const out: Record<string, unknown> = {};
  for (const pair of body.split(/,(?=\w+=)/)) {
    const eq = pair.indexOf('=');
    if (eq < 0) continue;
    const key = pair.slice(0, eq);
    const val = pair.slice(eq + 1);
    if (!['id', 'name', 'state', 'startDate', 'endDate', 'goal'].includes(key)) continue;
    out[key] = key === 'id' && /^\d+$/.test(val) ? Number(val) : val === '<null>' ? null : val;
  }
  return out;
}

function flattenSprint(value: unknown): unknown {
  if (typeof value === 'string') return parseLegacySprint(value);
  if (value && typeof value === 'object') {
    const o = value as Record<string, unknown>;
    return { id: o.id, name: o.name, state: o.state, startDate: o.startDate, endDate: o.endDate, goal: o.goal };
  }
  return value;
}

export function flattenFieldValue(value: unknown, def: JiraFieldDef): unknown {
  if (value === null || value === undefined) return null;
  if (Array.isArray(value)) return value.map(v => flattenFieldValue(v, def));
  if (isSprintField(def)) return flattenSprint(value);
  if (typeof value !== 'object') return value;

  const obj = value as Record<string, unknown>;
  if (obj.type === 'doc') return adfToMarkdown(obj);

  const label = obj.displayName ?? obj.name ?? obj.value;
  if (typeof label === 'string') {
    // Cascading select: { value, child: { value } }
    return obj.child ? `${label} / ${String(flattenFieldValue(obj.child, def))}` : label;
  }
  return value;
}

// ── Write ────────────────────────────────────────────

export interface FieldWrite {
  value?: unknown;
  /** Sprint membership is set through the Agile API, not the issue fields. */
  sprintId?: number;
}

function splitList(raw: string): string[] {
  return raw.split(',').map(s => s.trim()).filter(Boolean);
}

function parseJsonOrString(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

function itemValue(kind: string | undefined, raw: string, deployment: DeploymentType): unknown {
  switch (kind) {
    case 'option': return { value: raw };
    case 'user': return deployment === 'cloud' ? { accountId: raw } : { name: raw };
    case 'version':
    case 'component':
    case 'priority':
    case 'resolution': return { name: raw };
    case 'string': return raw;
    default: return parseJsonOrString(raw);
  }
}

export function toFieldWrite(def: JiraFieldDef, raw: string, deployment: DeploymentType, json = false): FieldWrite {
  if (json) {
    try {
      return { value: JSON.parse(raw) };
    } catch {
      throw new ConfigError(`Value for field "${def.name}" is not valid JSON.`);
    }
  }

  if (isSprintField(def)) {
    if (!/^\d+$/.test(raw.trim())) {
      throw new ConfigError(`Sprint field "${def.name}" takes a numeric sprint ID.`);
    }
    return { sprintId: Number(raw.trim()) };
  }

  const type = def.schema?.type;
  switch (type) {
    case 'string':
      return { value: deployment === 'cloud' && def.schema?.custom?.endsWith(':textarea') ? textToAdf(raw) : raw };
    case 'number': {
      const n = Number(raw);
      if (raw.trim() === '' || Number.isNaN(n)) {
        throw new ConfigError(`Field "${def.name}" expects a number.`);
      }
      return { value: n };
    }
    case 'date':
    case 'datetime':
    case 'team':
      return { value: raw };
    case 'option':
    case 'user':
    case 'version':
    case 'component':
    case 'priority':
    case 'resolution':
      return { value: itemValue(type, raw, deployment) };
    case 'option-with-child': {
      const [parent, child] = raw.split('/').map(s => s.trim());
      return { value: child ? { value: parent, child: { value: child } } : { value: parent } };
    }
    case 'project':
      return { value: { key: raw } };
    case 'array':
      return { value: splitList(raw).map(v => itemValue(def.schema?.items, v, deployment)) };
    default:
      // Unknown custom types (e.g. Team on Data Center): numbers/objects via JSON, else a string.
      return { value: parseJsonOrString(raw) };
  }
}
