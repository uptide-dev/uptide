// biome-ignore-all lint/suspicious/noTemplateCurlyInString: GitHub Actions expressions, written as they appear in the workflow.
import { COREPACK_VERSION, PINNED_ACTIONS, UPTIDE_ACTION, usesLine } from './actions.js';
import type { RepoFacts } from './facts.js';
import {
  MANUAL_SCHEDULE,
  UPTIDE_CONFIG_FILE,
  UPTIDE_CONFIG_SCHEMA_URL,
  type UptideConfig,
} from './schema.js';

export const WORKFLOW_PATH = '.github/workflows/uptide.yml';
const DOCS = 'https://github.com/uptide-dev/uptide/blob/main/docs';

/** `pnpm 10.17.1 (packageManager, through Corepack)`: the manager as the PR body names it. */
export function managerLabel(m: RepoFacts['manager']): string {
  const name = m.name === 'yarn' ? `Yarn ${m.flavor === 'berry' ? 'Berry' : 'classic'}` : m.name;
  const version = m.version ? ` ${m.version}` : '';
  const how = m.declared
    ? 'from packageManager, run through Corepack'
    : m.name === 'pnpm'
      ? 'implied by the lockfile, set up with pnpm/action-setup'
      : m.flavor === 'berry'
        ? 'the yarnPath in .yarnrc.yml'
        : 'the version on the runner';
  return `${name}${version} (${how})`;
}

const nodeInput = (node: RepoFacts['node']): string =>
  node.file ? `node-version-file: ${node.file}` : `node-version: '${node.version}'`;

function setupSteps(facts: RepoFacts): string[] {
  const m = facts.manager;
  const node = nodeInput(facts.node);
  const setupNode = (cache: boolean): string =>
    [
      `      - uses: ${usesLine(PINNED_ACTIONS.setupNode)}`,
      '        with:',
      `          ${node}`,
      ...(cache ? [`          cache: ${m.name}`] : []),
    ].join('\n');
  const corepack = (enable: string): string =>
    [
      `      - name: Enable Corepack for ${m.declared}`,
      '        run: |',
      `          npm install --global corepack@${COREPACK_VERSION}`,
      `          ${enable}`,
    ].join('\n');
  if (m.declared && m.name === 'npm') return [setupNode(true), corepack('corepack enable npm')];
  // setup-node's cache asks the package manager where its cache is, so Corepack comes first.
  if (m.declared) return [setupNode(false), corepack('corepack enable'), setupNode(true)];
  if (m.name === 'pnpm')
    return [
      [
        `      - uses: ${usesLine(PINNED_ACTIONS.pnpm)}`,
        '        with:',
        `          version: '${m.version}'`,
      ].join('\n'),
      setupNode(true),
    ];
  return [setupNode(true)];
}

/** `.github/workflows/uptide.yml`. */
export function renderWorkflow(facts: RepoFacts, config: UptideConfig): string {
  const action = [
    '      # Reads uptide.yml, runs Uptide, opens draft pull requests and uploads the results JSON.',
    `      - uses: ${usesLine(UPTIDE_ACTION)}`,
    '        with:',
    `          config: ${UPTIDE_CONFIG_FILE}`,
    "          mode: ${{ inputs.mode || 'fix' }}",
    '          package: ${{ inputs.package }}',
    ...(config.llm.enabled
      ? ['          anthropic-api-key: ${{ secrets.ANTHROPIC_API_KEY }}']
      : []),
  ].join('\n');
  // `manual`: no schedule trigger at all, only workflow_dispatch.
  const trigger =
    config.schedule === MANUAL_SCHEDULE
      ? `  # uptide.yml "schedule" is manual: runs start from the Actions tab or the Uptide dashboard.
  # After changing it there, run \`npx uptide init --force\`.
`
      : `  schedule:
    # uptide.yml "schedule" (UTC). After changing it there, run \`npx uptide init --force\`.
    - cron: '${config.schedule}'
`;
  return `# Uptide: dependency upgrades, checked and migrated in this repository's own GitHub Actions.
# Settings are in uptide.yml. How this file was made, and how to change it:
# ${DOCS}/commands/init.md
name: Uptide

on:
${trigger}  workflow_dispatch:
    inputs:
      mode:
        description: 'list: what is behind. check: what an upgrade breaks. fix: open draft pull requests with verified migrations.'
        type: choice
        options: [list, check, fix]
        default: check
      package:
        description: 'One dependency to check or fix. Empty: every dependency uptide.yml allows.'
        type: string
        required: false

# Nothing else: no access to issues, packages, deployments or other repositories.
permissions:
  contents: write # push migration branches
  pull-requests: write # open draft pull requests
  id-token: write # prove to Uptide that the results JSON comes from this workflow

concurrency:
  group: uptide
  cancel-in-progress: false

jobs:
  uptide:
    runs-on: ubuntu-latest
    timeout-minutes: 60
    steps:
      - uses: ${usesLine(PINNED_ACTIONS.checkout)}
        with:
          persist-credentials: false
${setupSteps(facts).join('\n')}
      # Exactly what ${facts.manager.lockfile} pins, with dependency install scripts off.
      - name: Install dependencies
        run: ${facts.manager.install}
${action}
`;
}

/** `uptide.yml`, one comment per setting. */
export function renderConfig(config: UptideConfig): string {
  const list = (items: string[]): string =>
    items.length ? `\n${items.map((i) => `    - '${i}'`).join('\n')}` : ' []';
  return `# Uptide settings, read by the Uptide workflow and by the uptide CLI.
# Reference: ${DOCS}/config.md
# yaml-language-server: $schema=${UPTIDE_CONFIG_SCHEMA_URL}

# Format of this file. Only 1 exists.
version: 1

# Which dependencies Uptide looks at, as npm package name globs ("@types/*", "eslint-*").
packages:
  # Only these. Empty: every dependency.
  allow:${list(config.packages.allow)}
  # Never these, even when allow matches them.
  deny:${list(config.packages.deny)}

${
  config.schedule === MANUAL_SCHEDULE
    ? `# When the workflow runs: manual, so never on a schedule. Runs start from the Uptide
# dashboard (Run now) or the Actions tab (Run workflow). A cron expression in UTC
# ('17 6 * * 1') schedules it; after changing this line, run \`npx uptide init --force\`.`
    : `# When the workflow runs: cron, in UTC, or manual to start runs only by hand. The workflow
# file holds a copy of this line; after changing it, run \`npx uptide init --force\`.`
}
schedule: '${config.schedule}'

# No new pull request is opened while this many Uptide pull requests are open.
# Uptide pull requests are always drafts.
maxOpenPrs: ${config.maxOpenPrs}

llm:
  # Assisted fixes for call sites no rule covers. false: no code is sent to an LLM.
  enabled: ${config.llm.enabled}
  # Who receives that code, with this repository's own key (secret ANTHROPIC_API_KEY).
  provider: ${config.llm.provider}

# Most one run may spend on LLM calls, in USD.
maxCost: ${config.maxCost}

# How assisted fixes are applied: auto (Uptide chooses), patch (one edit per call site),
# or sdk (experimental: a Claude Agent SDK session).
executor: ${config.executor}
`;
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** `every Monday at 06:17 UTC` for the schedules Uptide writes; the cron itself otherwise. */
export function describeSchedule(cron: string): string {
  if (cron === MANUAL_SCHEDULE) return 'only when someone starts it';
  const m = /^(\d{1,2}) (\d{1,2}) \* \* ([0-7])$/.exec(cron.trim());
  if (!m) return `on the cron schedule \`${cron}\` (UTC)`;
  const pad = (n: string) => n.padStart(2, '0');
  return `every ${WEEKDAYS[Number(m[3]) % 7]} at ${pad(m[2] as string)}:${pad(m[1] as string)} UTC`;
}

/** The pull request description: what runs, when, where, and what leaves CI. */
export function renderPrBody(facts: RepoFacts, config: UptideConfig): string {
  const m = facts.manager;
  const llm = config.llm.enabled;
  const detected = [
    `- Package manager: ${managerLabel(m)}`,
    `- Lockfile: \`${m.lockfile}\`, installed with \`${m.install}\``,
    `- Node: ${facts.node.source}`,
    `- Workspaces: ${facts.workspaces.length ? facts.workspaces.map((w) => `\`${w}\``).join(', ') : 'none (a single package)'}`,
    `- Default branch: \`${facts.defaultBranch}\``,
  ];
  return `This pull request adds Uptide to this repository. Nothing runs until it is merged.

Uptide finds dependency upgrades that break your code, migrates the code, and checks the result with your own compiler and tests. Each migration arrives as a draft pull request for you to review.

## Files

- \`${WORKFLOW_PATH}\`: the GitHub Actions workflow that runs Uptide.
- \`${UPTIDE_CONFIG_FILE}\`: Uptide's settings, with a comment on each one.

## What runs, and when

${
  config.schedule === MANUAL_SCHEDULE
    ? 'The workflow has no schedule (`schedule: manual`): it runs only when someone starts it, with Run now in the Uptide dashboard or from the Actions tab (Run workflow), where you can pick a mode and one dependency. Each run:'
    : `The workflow runs ${describeSchedule(config.schedule)} (\`${config.schedule}\`), and when someone starts it from the Actions tab (Run workflow), where you can pick a mode and one dependency. Each run:`
}

1. Checks out \`${facts.defaultBranch}\`.
2. Sets up Node and installs your dependencies with \`${m.install}\`. Install scripts of dependencies do not run.
3. Runs Uptide. It looks for dependencies that are behind, checks which of your call sites each upgrade breaks, and opens a draft pull request when it can migrate them and your compiler and tests pass. At most ${config.maxOpenPrs} Uptide pull requests are open at a time.

## Where it runs

In this repository's own GitHub Actions, on GitHub's runners, like your other workflows. The workflow can push branches and open pull requests in this repository and nothing else:

- \`contents: write\` to push migration branches
- \`pull-requests: write\` to open draft pull requests
- \`id-token: write\` to prove to Uptide that the results come from this workflow

## What leaves CI

- **The results of each run, as JSON, sent to Uptide**: which dependencies were checked, what an upgrade breaks and where, and which pull requests were opened. Your source code is not sent.
- **${llm ? `Code sent to ${providerName(config.llm.provider)}, with this repository's own API key` : 'Nothing else: the LLM is turned off in uptide.yml'}**${llm ? `, only for call sites no rule can fix: the code around each one. Spending stops at $${config.maxCost} per run (\`maxCost\` in uptide.yml).` : '.'}

Nothing else leaves the runner.

## Set the API key

${
  llm
    ? `Assisted fixes need an Anthropic API key, stored as a repository secret named \`ANTHROPIC_API_KEY\`:

- In GitHub: Settings, Secrets and variables, Actions, New repository secret.
- Or with the GitHub CLI: \`gh secret set ANTHROPIC_API_KEY\`

Without the secret, Uptide still runs and applies only its rule-based fixes. The key is passed to the Uptide step alone, never to the install step or to your tests.`
    : 'Not needed: the LLM is turned off in uptide.yml.'
}

## Turn the LLM off

Set \`enabled: false\` under \`llm\` in \`uptide.yml\`. Uptide then sends no code anywhere and applies only rule-based fixes. You can also delete the \`ANTHROPIC_API_KEY\` secret.

## Remove Uptide

Delete \`${WORKFLOW_PATH}\` and \`${UPTIDE_CONFIG_FILE}\`, and the \`ANTHROPIC_API_KEY\` secret if you added it. If you installed the Uptide GitHub App, uninstall it in Settings, GitHub Apps. To not start at all, close this pull request.

## Detected in this repository

${detected.join('\n')}
`;
}

const providerName = (p: UptideConfig['llm']['provider']): string =>
  ({ anthropic: 'Anthropic', openai: 'OpenAI', gemini: 'Google' })[p];
