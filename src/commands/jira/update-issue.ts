import type { Command } from 'commander';
import chalk from 'chalk';
import { loadConfig, requireJiraConfig } from '../../config.js';
import { createHttpClient } from '../../http.js';
import { createJiraClient } from '../../clients/jira.js';
import { detectOutputMode, output } from '../../output.js';
import { FIELD_OPTION_DESC, FIELD_OPTION_FLAGS, collectField, parseFieldSpecs } from './field-option.js';
import type { JiraIssue } from '../../types/jira.js';

function formatHuman(issue: JiraIssue): string {
  return [
    chalk.green('Issue updated successfully'),
    '',
    `  Key:     ${chalk.cyan(issue.key)}`,
    `  Summary: ${issue.summary}`,
    `  Status:  ${issue.status}`,
    `  URL:     ${issue.url}`,
  ].join('\n');
}

export function registerUpdateIssueCommand(jira: Command): void {
  jira
    .command('update-issue <key>')
    .description('Update an existing Jira issue')
    .option('-s, --summary <text>', 'New summary')
    .option('-d, --description <text>', 'New description')
    .option('--assignee <user>', 'Assignee (accountId for Cloud, username for Server)')
    .option('--priority <name>', 'Priority name')
    .option('--labels <labels>', 'Replace all labels (comma-separated)')
    .option('--add-labels <labels>', 'Add labels (comma-separated)')
    .option('--remove-labels <labels>', 'Remove labels (comma-separated)')
    .option('--components <components>', 'Replace all components (comma-separated)')
    .option(FIELD_OPTION_FLAGS, FIELD_OPTION_DESC, collectField, [] as string[])
    .action(async (key: string, opts: {
      summary?: string;
      description?: string;
      assignee?: string;
      priority?: string;
      labels?: string;
      addLabels?: string;
      removeLabels?: string;
      components?: string;
      field?: string[];
    }, command: Command) => {
      const config = loadConfig();
      const jiraConfig = requireJiraConfig(config);
      const http = createHttpClient(jiraConfig);
      const client = createJiraClient(http, jiraConfig.baseUrl, jiraConfig.deployment, jiraConfig.fieldPolicy);
      const ctx = detectOutputMode(command.optsWithGlobals().json);

      await client.updateIssue(key, {
        summary: opts.summary,
        description: opts.description,
        assignee: opts.assignee,
        priority: opts.priority,
        labels: opts.labels?.split(',').map(l => l.trim()),
        addLabels: opts.addLabels?.split(',').map(l => l.trim()),
        removeLabels: opts.removeLabels?.split(',').map(l => l.trim()),
        components: opts.components?.split(',').map(c => c.trim()),
        customFields: parseFieldSpecs(opts.field),
      });

      // Fetch updated issue to return current state
      const updated = await client.getIssue(key);
      output(updated, formatHuman, ctx);
    });
}
