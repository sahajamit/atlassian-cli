import type { Command } from 'commander';
import chalk from 'chalk';
import { loadConfig, requireJiraConfig } from '../../config.js';
import { createHttpClient } from '../../http.js';
import { createJiraClient } from '../../clients/jira.js';
import { detectOutputMode, output, formatTable } from '../../output.js';
import type { JiraSearchResult } from '../../types/jira.js';

function formatHuman(result: JiraSearchResult): string {
  const lines: string[] = [];

  lines.push(chalk.bold(`Found ${result.total} issue(s)`) + (result.hasMore ? ' (more available)' : ''));
  lines.push('');

  if (result.issues.length === 0) {
    lines.push('No issues found.');
    return lines.join('\n');
  }

  const headers = ['Key', 'Summary', 'Status', 'Assignee', 'Priority'];
  const rows = result.issues.map(issue => [
    chalk.cyan(issue.key),
    issue.summary.length > 60 ? issue.summary.slice(0, 57) + '...' : issue.summary,
    issue.status,
    issue.assignee ?? 'Unassigned',
    issue.priority ?? '-',
  ]);

  lines.push(formatTable(headers, rows));
  return lines.join('\n');
}

export function registerSearchCommand(jira: Command): void {
  jira
    .command('search <jql>')
    .description('Search Jira issues using JQL')
    .option('-f, --fields <fields>', 'Comma-separated fields to return (names or IDs, including custom fields)')
    .option('-l, --limit <n>', 'Maximum results to return', '20')
    .option('--offset <n>', 'Start at this result index', '0')
    .action(async (jql: string, opts: { fields?: string; limit: string; offset: string }, command: Command) => {
      const config = loadConfig();
      const jiraConfig = requireJiraConfig(config);
      const http = createHttpClient(jiraConfig);
      const client = createJiraClient(http, jiraConfig.baseUrl, jiraConfig.deployment, jiraConfig.fieldPolicy);
      const ctx = detectOutputMode(command.optsWithGlobals().json);

      const fields = opts.fields ? opts.fields.split(',').map(f => f.trim()) : undefined;
      const result = await client.search(jql, {
        fields,
        limit: parseInt(opts.limit, 10),
        offset: parseInt(opts.offset, 10),
      });

      output(result, formatHuman, ctx);
    });
}
