import type { Command } from 'commander';
import chalk from 'chalk';
import { loadConfig, requireJiraConfig } from '../../config.js';
import { createHttpClient } from '../../http.js';
import { createJiraClient } from '../../clients/jira.js';
import { detectOutputMode, output } from '../../output.js';
import { FIELD_OPTION_DESC, FIELD_OPTION_FLAGS, collectField, parseFieldSpecs } from './field-option.js';
import type { JiraCreateIssueResult } from '../../types/jira.js';

function formatHuman(result: JiraCreateIssueResult): string {
  return [
    chalk.green('Issue created successfully'),
    '',
    `  Key:  ${chalk.cyan(result.key)}`,
    `  URL:  ${result.url}`,
  ].join('\n');
}

export function registerCreateIssueCommand(jira: Command): void {
  jira
    .command('create-issue')
    .description('Create a new Jira issue')
    .requiredOption('-p, --project <key>', 'Project key (e.g. PROJ)')
    .requiredOption('-t, --type <type>', 'Issue type (e.g. Bug, Task, Story)')
    .requiredOption('-s, --summary <text>', 'Issue summary')
    .option('-d, --description <text>', 'Issue description')
    .option('--assignee <user>', 'Assignee (accountId for Cloud, username for Server)')
    .option('--priority <name>', 'Priority name (e.g. High, Medium, Low)')
    .option('--labels <labels>', 'Comma-separated labels')
    .option('--components <components>', 'Comma-separated component names')
    .option('--parent <key>', 'Parent issue key (for sub-tasks)')
    .option(FIELD_OPTION_FLAGS, FIELD_OPTION_DESC, collectField, [] as string[])
    .action(async (opts: {
      project: string;
      type: string;
      summary: string;
      description?: string;
      assignee?: string;
      priority?: string;
      labels?: string;
      components?: string;
      parent?: string;
      field?: string[];
    }, command: Command) => {
      const config = loadConfig();
      const jiraConfig = requireJiraConfig(config);
      const http = createHttpClient(jiraConfig);
      const client = createJiraClient(http, jiraConfig.baseUrl, jiraConfig.deployment, jiraConfig.fieldPolicy);
      const ctx = detectOutputMode(command.optsWithGlobals().json);

      const result = await client.createIssue({
        projectKey: opts.project,
        issueType: opts.type,
        summary: opts.summary,
        description: opts.description,
        assignee: opts.assignee,
        priority: opts.priority,
        labels: opts.labels?.split(',').map(l => l.trim()),
        components: opts.components?.split(',').map(c => c.trim()),
        parentKey: opts.parent,
        customFields: parseFieldSpecs(opts.field),
      });

      output(result, formatHuman, ctx);
    });
}
