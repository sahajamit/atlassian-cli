export type AuthMethod =
  | { type: 'basic'; username: string; token: string }
  | { type: 'pat'; token: string };

export type DeploymentType = 'cloud' | 'server';

export interface FieldPolicy {
  /** Lower-cased field IDs or names. When non-empty, only these custom fields are visible. */
  allow: string[];
  /** Lower-cased field IDs or names that are never read or written. */
  block: string[];
}

export interface ServiceConfig {
  baseUrl: string;
  auth: AuthMethod;
  deployment: DeploymentType;
  fieldPolicy?: FieldPolicy;
}

export interface Config {
  jira?: ServiceConfig;
  confluence?: ServiceConfig;
}
