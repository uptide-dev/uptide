This pull request adds Uptide to this repository. Nothing runs until it is merged.

Uptide finds dependency upgrades that break your code, migrates the code, and checks the result with your own compiler and tests. Each migration arrives as a draft pull request for you to review.

## Files

- `.github/workflows/uptide.yml`: the GitHub Actions workflow that runs Uptide.
- `uptide.yml`: Uptide's settings, with a comment on each one.

## What runs, and when

The workflow runs every Monday at 07:54 UTC (`54 7 * * 1`), and when someone starts it from the Actions tab (Run workflow), where you can pick a mode and one dependency. Each run:

1. Checks out `main`.
2. Sets up Node and installs your dependencies with `pnpm install --frozen-lockfile --ignore-scripts`. Install scripts of dependencies do not run.
3. Runs Uptide. It looks for dependencies that are behind, checks which of your call sites each upgrade breaks, and opens a draft pull request when it can migrate them and your compiler and tests pass. At most 3 Uptide pull requests are open at a time.

## Where it runs

In this repository's own GitHub Actions, on GitHub's runners, like your other workflows. The workflow itself only reads the repository:

- `contents: read` to check it out
- `id-token: write` to prove to Uptide that a run is this repository's workflow

With that proof, the Uptide GitHub App gives the run a token that expires within the hour, and Uptide pushes its migration branches and opens its draft pull requests with it, in this repository only. Pull requests opened that way run your CI; ones opened with the workflow's own token would not.

## What leaves CI

- **The results of each run, as JSON, sent to Uptide**: which dependencies were checked, what an upgrade breaks and where, and which pull requests were opened. Your source code is not sent.
- **Code sent to Anthropic, with this repository's own API key**, only for call sites no rule can fix: the code around each one. Spending stops at $1 per run (`maxCost` in uptide.yml).

Nothing else leaves the runner.

## Set the API key

Assisted fixes need an Anthropic API key, stored as a repository secret named `ANTHROPIC_API_KEY`:

- In GitHub: Settings, Secrets and variables, Actions, New repository secret.
- Or with the GitHub CLI: `gh secret set ANTHROPIC_API_KEY`

Without the secret, Uptide still runs and applies only its rule-based fixes. The key is passed to the Uptide step alone, never to the install step or to your tests.

## Turn the LLM off

Set `enabled: false` under `llm` in `uptide.yml`. Uptide then sends no code anywhere and applies only rule-based fixes. You can also delete the `ANTHROPIC_API_KEY` secret.

## Remove Uptide

Delete `.github/workflows/uptide.yml` and `uptide.yml`, and the `ANTHROPIC_API_KEY` secret if you added it. If you installed the Uptide GitHub App, uninstall it in Settings, GitHub Apps. To not start at all, close this pull request.

## Detected in this repository

- Package manager: pnpm 10.17.1 (from packageManager, run through Corepack)
- Lockfile: `pnpm-lock.yaml`, installed with `pnpm install --frozen-lockfile --ignore-scripts`
- Node: .nvmrc (22)
- Workspaces: none (a single package)
- Default branch: `main`
