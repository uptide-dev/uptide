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
    '          anthropic-api-key: ${{ secrets.ANTHROPIC_API_KEY }}',
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

# Read-only, plus an identity. Branches and pull requests are pushed with a short-lived token
# of the Uptide GitHub App, issued to this run once GitHub proves who it is (id-token), so
# Uptide's pull requests run your CI like anyone else's.
permissions:
  contents: read # check out the repository
  id-token: write # prove to Uptide that this run is this repository's workflow

concurrency:
  group: uptide
  cancel-in-progress: false

jobs:
  uptide:
    # A pinned image: a new Ubuntu release reaches this job only with a change to this line.
    runs-on: ubuntu-24.04
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
  # Who receives the code around call sites no rule covers, with this repository's own key
  # (secret ANTHROPIC_API_KEY). The Uptide workflow does not run without that key.
  provider: ${config.llm.provider}

# LLM budget in USD; the SDK may overshoot by one turn.
maxCost: ${config.maxCost}

# How assisted fixes are applied: auto (SDK for Anthropic when installed, patch otherwise), patch (one edit per call site),
# or sdk (a Claude Agent SDK session).
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

In this repository's own GitHub Actions, on GitHub's runners, like your other workflows. The workflow itself only reads the repository:

- \`contents: read\` to check it out
- \`id-token: write\` to prove to Uptide that a run is this repository's workflow

With that proof, the Uptide GitHub App gives the run a token that expires within the hour, and Uptide pushes its migration branches and opens its draft pull requests with it, in this repository only. Pull requests opened that way run your CI; ones opened with the workflow's own token would not.

## What leaves the runner

- **The run report, to Uptide**, as \`uptide.run/v1\` JSON: which dependencies were checked, what an upgrade breaks and where (file paths, line numbers and symbol names), how verification went, and which pull requests were opened. It never contains source code, diffs or environment values. With it goes the job's OIDC token, which proves the run is this repository's workflow. [How Uptide handles your data](${TRUST_URL}).
- **The npm registry**: the Uptide engine's own dependencies during setup, metadata and tarballs of the packages Uptide compares, and the public names and installed versions of your dependencies to npm's advisory endpoint.
- **GitHub**: the checkout, and the migration branches and draft pull requests Uptide pushes with the Uptide GitHub App's token.
- ${llmLine(config)}

## Set the API key

Uptide needs an Anthropic API key, stored as a repository secret named \`ANTHROPIC_API_KEY\`:

- In GitHub: Settings → Secrets and variables → Actions → New repository secret.
- Or with the GitHub CLI: \`gh secret set ANTHROPIC_API_KEY\`

Without the secret, the workflow does not run Uptide: the job fails and its summary says what to add. The key is passed to the Uptide step alone, never to the install step or to your tests.

## Remove Uptide

Delete \`${WORKFLOW_PATH}\` and \`${UPTIDE_CONFIG_FILE}\`, and the \`ANTHROPIC_API_KEY\` secret. If you installed the Uptide GitHub App, uninstall it in Settings, GitHub Apps. To not start at all, close this pull request.

## Detected in this repository

${detected.join('\n')}
`;
}

/** Where the "Add Uptide" pull request sends people who want to know what Uptide keeps. */
export const TRUST_URL = 'https://uptide-app.vercel.app/trust';

/**
 * What goes to an LLM from the runner, as the Action actually does it: Anthropic only (the
 * generator refuses another provider), and the Agent SDK unless \`executor: patch\`.
 */
function llmLine(config: UptideConfig): string {
  const budget = `Spending stops at $${config.maxCost} per run (\`maxCost\` in uptide.yml).`;
  return config.executor === 'patch'
    ? `**Code sent to Anthropic, with this repository's own API key**, for call sites no rule can fix: the code around each one. ${budget}`
    : `**Code sent to Anthropic, with this repository's own API key**, for call sites no rule can fix. The assisted fixer (the Claude Agent SDK) can read any file in the checkout to work out a fix, and what it reads goes to Anthropic with its requests. ${budget}`;
}
