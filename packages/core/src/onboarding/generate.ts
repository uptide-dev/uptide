import { type UptideConfigInput, withDefaults } from './config.js';
import { weeklySchedule } from './cron.js';
import { OnboardingRefusal, type RepoFacts } from './facts.js';
import { renderConfig, renderPrBody, renderWorkflow, WORKFLOW_PATH } from './render.js';
import { UPTIDE_CONFIG_FILE, type UptideConfig } from './schema.js';

export interface OnboardingFile {
  path: string;
  content: string;
}

export interface Onboarding {
  /** The workflow, then `uptide.yml`. */
  files: OnboardingFile[];
  prTitle: string;
  prBody: string;
  /** The settings the files were written from. */
  config: UptideConfig;
}

export const ONBOARDING_PR_TITLE = 'Add Uptide';

/**
 * The files of the "Add Uptide" pull request, from facts alone: no file system, no network,
 * no clock. The same facts give the same bytes in the CLI and in the App.
 *
 * `config` is an existing `uptide.yml` (already parsed) whose settings the files keep; without
 * it the defaults apply, with a weekly schedule derived from the repository so that
 * repositories do not all start at the same minute.
 */
export function generateOnboarding(
  facts: RepoFacts,
  options: { config?: UptideConfigInput } = {},
): Onboarding {
  const seed = facts.slug ?? facts.name ?? 'uptide';
  const config = withDefaults({
    ...options.config,
    version: 1,
    schedule: options.config?.schedule ?? weeklySchedule(seed),
  });
  if (config.llm.enabled && config.llm.provider !== 'anthropic')
    throw new OnboardingRefusal(
      'unsupported-provider',
      `uptide.yml sets llm.provider to ${config.llm.provider}; the Uptide workflow passes only an Anthropic key (ANTHROPIC_API_KEY) for now. Use provider anthropic, or set llm.enabled to false.`,
    );
  return {
    files: [
      { path: WORKFLOW_PATH, content: renderWorkflow(facts, config) },
      { path: UPTIDE_CONFIG_FILE, content: renderConfig(config) },
    ],
    prTitle: ONBOARDING_PR_TITLE,
    prBody: renderPrBody(facts, config),
    config,
  };
}
