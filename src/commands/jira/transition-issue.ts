import type { Command } from 'commander';
import chalk from 'chalk';
import { loadConfig, requireJiraConfig } from '../../config.js';
import { createHttpClient } from '../../http.js';
import { createJiraClient } from '../../clients/jira.js';
import { detectOutputMode, output } from '../../output.js';
import { CliError } from '../../errors.js';

interface TransitionResult {
  key: string;
  transition: string;
  status: string;
  url: string;
}

function formatHuman(result: TransitionResult): string {
  return [
    chalk.green('Issue transitioned successfully'),
    '',
    `  Key:        ${chalk.cyan(result.key)}`,
    `  Transition: ${result.transition}`,
    `  Status:     ${result.status}`,
    `  URL:        ${result.url}`,
  ].join('\n');
}

export function registerTransitionIssueCommand(jira: Command): void {
  jira
    .command('transition-issue <key>')
    .description('Transition a Jira issue to a new status')
    .requiredOption('--transition <nameOrId>', 'Transition name or ID')
    .option('--comment <text>', 'Add a comment with the transition')
    .option('--resolution <name>', 'Set resolution (e.g. Done, Fixed)')
    .action(async (key: string, opts: {
      transition: string;
      comment?: string;
      resolution?: string;
    }, command: Command) => {
      const config = loadConfig();
      const jiraConfig = requireJiraConfig(config);
      const http = createHttpClient(jiraConfig);
      const client = createJiraClient(http, jiraConfig.baseUrl, jiraConfig.deployment, jiraConfig.fieldPolicy);
      const ctx = detectOutputMode(command.optsWithGlobals().json);

      // Resolve transition name to ID
      const transitions = await client.getTransitions(key);
      let matched = transitions.find(t => t.id === opts.transition);

      if (!matched) {
        // Try matching by name (case-insensitive)
        const needle = opts.transition.toLowerCase();
        const byName = transitions.filter(t => t.name.toLowerCase().includes(needle));
        if (byName.length === 1) {
          matched = byName[0]!;
        } else if (byName.length > 1) {
          const names = byName.map(t => `  - "${t.name}" (id: ${t.id})`).join('\n');
          throw new CliError(
            `Ambiguous transition "${opts.transition}". Did you mean:\n${names}`,
            'AMBIGUOUS_TRANSITION',
          );
        } else {
          const available = transitions.map(t => `  - "${t.name}" (id: ${t.id})`).join('\n');
          throw new CliError(
            `Transition "${opts.transition}" not found. Available transitions:\n${available}`,
            'TRANSITION_NOT_FOUND',
          );
        }
      }

      await client.transitionIssue(key, matched.id, {
        comment: opts.comment,
        resolution: opts.resolution,
      });

      const result: TransitionResult = {
        key,
        transition: matched.name,
        status: matched.to.name,
        url: `${jiraConfig.baseUrl}/browse/${key}`,
      };

      output(result, formatHuman, ctx);
    });
}
