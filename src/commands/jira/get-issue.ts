import type { Command } from 'commander';
import chalk from 'chalk';
import { loadConfig, requireJiraConfig } from '../../config.js';
import { createHttpClient } from '../../http.js';
import { createJiraClient } from '../../clients/jira.js';
import { detectOutputMode, output } from '../../output.js';
import type { JiraIssue } from '../../types/jira.js';

function formatHuman(issue: JiraIssue): string {
  const lines: string[] = [];

  lines.push(chalk.bold.cyan(issue.key) + '  ' + chalk.bold(issue.summary));
  lines.push('');
  lines.push(`  ${chalk.dim('Status:')}     ${issue.status}`);
  lines.push(`  ${chalk.dim('Type:')}       ${issue.issueType}`);
  lines.push(`  ${chalk.dim('Priority:')}   ${issue.priority ?? '-'}`);
  lines.push(`  ${chalk.dim('Assignee:')}   ${issue.assignee ?? 'Unassigned'}`);
  lines.push(`  ${chalk.dim('Reporter:')}   ${issue.reporter ?? '-'}`);
  lines.push(`  ${chalk.dim('Labels:')}     ${issue.labels.length ? issue.labels.join(', ') : '-'}`);
  lines.push(`  ${chalk.dim('Components:')} ${issue.components.length ? issue.components.join(', ') : '-'}`);
  lines.push(`  ${chalk.dim('Created:')}    ${issue.created}`);
  lines.push(`  ${chalk.dim('Updated:')}    ${issue.updated}`);
  lines.push(`  ${chalk.dim('URL:')}        ${issue.url}`);

  for (const [name, value] of Object.entries(issue.customFields)) {
    const text = typeof value === 'string' ? value : JSON.stringify(value);
    lines.push(`  ${chalk.dim(name + ':')} ${text}`);
  }

  if (issue.description) {
    lines.push('');
    lines.push(chalk.bold('Description'));
    lines.push(issue.description);
  }

  if (issue.attachments.length > 0) {
    lines.push('');
    lines.push(chalk.bold(`Attachments (${issue.attachments.length})`));
    for (const att of issue.attachments) {
      const size = att.size > 0 ? ` (${(att.size / 1024).toFixed(1)} KB)` : '';
      lines.push(`  ${att.filename}${size}  ${chalk.dim(att.mimeType)}`);
    }
  }

  if (issue.images.length > 0) {
    lines.push('');
    lines.push(chalk.bold(`Images (${issue.images.length})`));
    for (const img of issue.images) {
      const size = img.fileSize ? ` (${(img.fileSize / 1024).toFixed(1)} KB)` : '';
      lines.push(`  ${img.filename}${size} — ${chalk.dim(img.url)}`);
    }
  }

  if (issue.comments.length > 0) {
    lines.push('');
    lines.push(chalk.bold(`Comments (${issue.comments.length})`));
    for (const comment of issue.comments) {
      lines.push('');
      lines.push(`  ${chalk.dim(comment.author)} — ${chalk.dim(comment.created)}`);
      lines.push(`  ${comment.body}`);
    }
  }

  return lines.join('\n');
}

export function registerGetIssueCommand(jira: Command): void {
  jira
    .command('get-issue <key>')
    .description('Get full details of a Jira issue')
    .option('-f, --fields <fields>', 'Comma-separated fields to return (names or IDs, including custom fields)')
    .option('-c, --comments <n>', 'Max comments to include', '10')
    .action(async (key: string, opts: { fields?: string; comments: string }, command: Command) => {
      const config = loadConfig();
      const jiraConfig = requireJiraConfig(config);
      const http = createHttpClient(jiraConfig);
      const client = createJiraClient(http, jiraConfig.baseUrl, jiraConfig.deployment, jiraConfig.fieldPolicy);
      const ctx = detectOutputMode(command.optsWithGlobals().json);

      const fields = opts.fields ? opts.fields.split(',').map(f => f.trim()) : undefined;
      const issue = await client.getIssue(key, {
        fields,
        commentLimit: parseInt(opts.comments, 10),
      });

      output(issue, formatHuman, ctx);
    });
}
