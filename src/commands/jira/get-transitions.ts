import type { Command } from 'commander';
import chalk from 'chalk';
import { loadConfig, requireJiraConfig } from '../../config.js';
import { createHttpClient } from '../../http.js';
import { createJiraClient } from '../../clients/jira.js';
import { detectOutputMode, output, formatTable } from '../../output.js';
import type { JiraTransition } from '../../types/jira.js';

function formatHuman(transitions: JiraTransition[]): string {
  if (transitions.length === 0) {
    return 'No transitions available for this issue.';
  }

  const lines: string[] = [
    chalk.bold(`Available transitions (${transitions.length})`),
    '',
  ];

  const headers = ['ID', 'Name', 'To Status', 'Category'];
  const rows = transitions.map(t => [
    t.id,
    chalk.cyan(t.name),
    t.to.name,
    t.to.statusCategory,
  ]);

  lines.push(formatTable(headers, rows));
  return lines.join('\n');
}

export function registerGetTransitionsCommand(jira: Command): void {
  jira
    .command('get-transitions <key>')
    .description('Get available transitions for a Jira issue')
    .action(async (key: string, _opts: Record<string, unknown>, command: Command) => {
      const config = loadConfig();
      const jiraConfig = requireJiraConfig(config);
      const http = createHttpClient(jiraConfig);
      const client = createJiraClient(http, jiraConfig.baseUrl, jiraConfig.deployment, jiraConfig.fieldPolicy);
      const ctx = detectOutputMode(command.optsWithGlobals().json);

      const transitions = await client.getTransitions(key);
      output(transitions, formatHuman, ctx);
    });
}
