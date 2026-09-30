import { ConfigError } from '../../errors.js';
import type { JiraCustomFieldInput } from '../../types/jira.js';

export const FIELD_OPTION_FLAGS = '--field <name=value>';
export const FIELD_OPTION_DESC =
  'Set any field by name or ID (repeatable). Use "Name:=<json>" for raw JSON values';

export function collectField(value: string, previous: string[]): string[] {
  return [...previous, value];
}

export function parseFieldSpecs(specs: string[] | undefined): JiraCustomFieldInput[] {
  return (specs ?? []).map(spec => {
    const eq = spec.indexOf('=');
    if (eq <= 0) throw new ConfigError(`Invalid --field "${spec}". Expected name=value.`);
    const json = spec[eq - 1] === ':';
    const field = spec.slice(0, json ? eq - 1 : eq).trim();
    if (!field) throw new ConfigError(`Invalid --field "${spec}". Field name is empty.`);
    return { field, value: spec.slice(eq + 1), json };
  });
}
