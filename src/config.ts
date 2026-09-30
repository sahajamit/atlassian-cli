import { ConfigError } from './errors.js';
import { parseFieldPolicy } from './field-policy.js';
import type { AuthMethod, Config, DeploymentType, ServiceConfig } from './types/common.js';

function isCloud(url: string): boolean {
  return url.includes('atlassian.net');
}

function detectDeployment(url: string): DeploymentType {
  return isCloud(url) ? 'cloud' : 'server';
}

function buildAuth(
  deployment: DeploymentType,
  username: string | undefined,
  apiToken: string | undefined,
  personalToken: string | undefined,
  serviceName: string,
): AuthMethod {
  if (deployment === 'cloud') {
    if (!username || !apiToken) {
      throw new ConfigError(
        `${serviceName} Cloud requires ${serviceName.toUpperCase()}_USERNAME and ${serviceName.toUpperCase()}_API_TOKEN. ` +
        `Get an API token at https://id.atlassian.com/manage-profile/security/api-tokens`,
      );
    }
    return { type: 'basic', username, token: apiToken };
  }

  // Server/DC: prefer PAT, fallback to basic
  if (personalToken) {
    return { type: 'pat', token: personalToken };
  }
  if (username && apiToken) {
    return { type: 'basic', username, token: apiToken };
  }

  throw new ConfigError(
    `${serviceName} Server/DC requires ${serviceName.toUpperCase()}_PERSONAL_TOKEN ` +
    `or both ${serviceName.toUpperCase()}_USERNAME and ${serviceName.toUpperCase()}_API_TOKEN.`,
  );
}

function normalizeUrl(url: string): string {
  return url.replace(/\/+$/, '');
}

function loadServiceConfig(
  urlEnv: string,
  usernameEnv: string,
  apiTokenEnv: string,
  personalTokenEnv: string,
  serviceName: string,
): ServiceConfig | undefined {
  const url = process.env[urlEnv];
  if (!url) return undefined;

  const deployment = detectDeployment(url);
  const auth = buildAuth(
    deployment,
    process.env[usernameEnv],
    process.env[apiTokenEnv],
    process.env[personalTokenEnv],
    serviceName,
  );

  return {
    baseUrl: normalizeUrl(url),
    auth,
    deployment,
  };
}

export function loadConfig(): Config {
  const jira = loadServiceConfig(
    'JIRA_URL', 'JIRA_USERNAME', 'JIRA_API_TOKEN', 'JIRA_PERSONAL_TOKEN', 'Jira',
  );

  const confluence = loadServiceConfig(
    'CONFLUENCE_URL', 'CONFLUENCE_USERNAME', 'CONFLUENCE_API_TOKEN', 'CONFLUENCE_PERSONAL_TOKEN', 'Confluence',
  );

  if (!jira && !confluence) {
    throw new ConfigError(
      'No Atlassian services configured. Set JIRA_URL and/or CONFLUENCE_URL environment variables.',
    );
  }

  if (jira) {
    jira.fieldPolicy = parseFieldPolicy(process.env.JIRA_ALLOWED_FIELDS, process.env.JIRA_BLOCKED_FIELDS);
  }

  return { jira, confluence };
}

export function requireJiraConfig(config: Config): ServiceConfig {
  if (!config.jira) {
    throw new ConfigError('Jira is not configured. Set JIRA_URL environment variable.');
  }
  return config.jira;
}

export function requireConfluenceConfig(config: Config): ServiceConfig {
  if (!config.confluence) {
    throw new ConfigError('Confluence is not configured. Set CONFLUENCE_URL environment variable.');
  }
  return config.confluence;
}
