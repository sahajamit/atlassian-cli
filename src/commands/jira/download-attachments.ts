import { basename, join } from 'node:path';
import { tmpdir } from 'node:os';
import type { Command } from 'commander';
import chalk from 'chalk';
import { loadConfig, requireJiraConfig } from '../../config.js';
import { createHttpClient } from '../../http.js';
import { createJiraClient } from '../../clients/jira.js';
import { detectOutputMode, output } from '../../output.js';
import type { JiraAttachment } from '../../types/jira.js';

interface DownloadResult {
  issueKey: string;
  outputDir: string;
  downloaded: Array<{
    filename: string;
    path: string;
    mimeType: string;
    size: number;
  }>;
}

function formatHuman(result: DownloadResult): string {
  const lines: string[] = [];

  lines.push(chalk.bold(`Downloaded ${result.downloaded.length} attachment(s)`));
  lines.push(chalk.dim(`Issue: ${result.issueKey}  |  Directory: ${result.outputDir}`));
  lines.push('');

  if (result.downloaded.length === 0) {
    lines.push('No attachments matched the filter.');
    return lines.join('\n');
  }

  for (const file of result.downloaded) {
    const size = file.size > 0
      ? ` (${(file.size / 1024).toFixed(1)} KB)`
      : '';
    lines.push(`  ${chalk.green('✓')} ${file.filename}${size}`);
  }

  return lines.join('\n');
}

function filterAttachments(attachments: JiraAttachment[], filter: string): JiraAttachment[] {
  switch (filter) {
    case 'images':
      return attachments.filter(a => a.mimeType.startsWith('image/'));
    case 'documents':
      return attachments.filter(a => !a.mimeType.startsWith('image/'));
    default:
      return attachments;
  }
}

export function registerDownloadAttachmentsCommand(jira: Command): void {
  jira
    .command('download-attachments')
    .description('Download attachments from a Jira issue')
    .requiredOption('--issue-key <key>', 'Issue key (e.g. PROJ-123)')
    .option('--output-dir <dir>', 'Output directory')
    .option('--filter <type>', 'Filter type: images, documents, or all', 'all')
    .action(async (opts: { issueKey: string; outputDir?: string; filter: string }, command: Command) => {
      const config = loadConfig();
      const jiraConfig = requireJiraConfig(config);
      const http = createHttpClient(jiraConfig);
      const client = createJiraClient(http, jiraConfig.baseUrl, jiraConfig.deployment, jiraConfig.fieldPolicy);
      const ctx = detectOutputMode(command.optsWithGlobals().json);

      const outputDir = opts.outputDir ?? join(tmpdir(), 'jira-attachments', opts.issueKey);

      const allAttachments = await client.getAttachments(opts.issueKey);
      const attachments = filterAttachments(allAttachments, opts.filter);

      const downloaded: DownloadResult['downloaded'] = [];

      for (const attachment of attachments) {
        const safeName = basename(attachment.filename);
        if (!safeName || safeName === '.' || safeName === '..') {
          throw new Error(`Refusing to download attachment with unsafe filename: ${attachment.filename}`);
        }
        const destPath = join(outputDir, safeName);
        await client.downloadAttachment(attachment.downloadUrl, destPath);
        downloaded.push({
          filename: safeName,
          path: destPath,
          mimeType: attachment.mimeType,
          size: attachment.size,
        });
      }

      const result: DownloadResult = {
        issueKey: opts.issueKey,
        outputDir,
        downloaded,
      };

      output(result, formatHuman, ctx);
    });
}
