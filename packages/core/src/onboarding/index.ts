// The "Add Uptide" pull request and `uptide.yml`: what the GitHub App and `uptide init`
// both generate. Pure apart from `loadUptideConfig`, which reads a file; importable on its
// own as `@uptide/core/onboarding` without the analysis engine.
export {
  COREPACK_VERSION,
  PINNED_ACTIONS,
  type PinnedAction,
  UPTIDE_ACTION,
} from './actions.js';
export {
  type LoadedConfig,
  loadUptideConfig,
  packageSelected,
  parseUptideConfig,
  type UptideConfigInput,
  withDefaults,
} from './config.js';
export { cronProblem, weeklySchedule } from './cron.js';
export {
  DEFAULT_NODE,
  type ManagerName,
  ONBOARDING_INPUTS,
  type OnboardingInput,
  OnboardingRefusal,
  type RefusalReason,
  type RepoFacts,
  type RepoSnapshot,
  repoFacts,
} from './facts.js';
export {
  generateOnboarding,
  ONBOARDING_PR_TITLE,
  type Onboarding,
  type OnboardingFile,
} from './generate.js';
export { WORKFLOW_PATH } from './render.js';
export {
  DEFAULT_CONFIG,
  DEFAULT_SCHEDULE,
  EXECUTORS,
  type Executor,
  UPTIDE_CONFIG_FILE,
  UPTIDE_CONFIG_SCHEMA,
  UPTIDE_CONFIG_SCHEMA_URL,
  type UptideConfig,
} from './schema.js';
export { snapshotFromDisk } from './snapshot.js';
