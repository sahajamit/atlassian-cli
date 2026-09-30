import type { Command } from 'commander';
import chalk from 'chalk';
import { loadConfig, requireJiraConfig } from '../../config.js';
import { createHttpClient } from '../../http.js';
import { createJiraClient } from '../../clients/jira.js';
import { detectOutputMode, output, resolveBody } from '../../output.js';
import type { JiraAddCommentResult } from '../../types/jira.js';

function formatHuman(result: JiraAddCommentResult): string {
  return [
    chalk.green('Comment added successfully'),
    '',
    `  ID:      ${result.id}`,
    `  Author:  ${result.author}`,
    `  Created: ${result.created}`,
  ].join('\n');
}

export function registerAddCommentCommand(jira: Command): void {
  jira
    .command('add-comment <key> <body>')
    .description('Add a comment to a Jira issue (use "-" as body to read from stdin)')
    .action(async (key: string, bodyArg: string, _opts: Record<string, unknown>, command: Command) => {
      const config = loadConfig();
      const jiraConfig = requireJiraConfig(config);
      const http = createHttpClient(jiraConfig);
      const client = createJiraClient(http, jiraConfig.baseUrl, jiraConfig.deployment, jiraConfig.fieldPolicy);
      const ctx = detectOutputMode(command.optsWithGlobals().json);

      const body = await resolveBody(bodyArg);
      const result = await client.addComment(key, body);
      output(result, formatHuman, ctx);
    });
}
