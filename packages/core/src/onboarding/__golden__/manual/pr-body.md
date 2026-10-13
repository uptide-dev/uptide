This pull request adds Uptide to this repository. Nothing runs until it is merged.

Uptide finds dependency upgrades that break your code, migrates the code, and checks the result with your own compiler and tests. Each migration arrives as a draft pull request for you to review.

## Files

- `.github/workflows/uptide.yml`: the GitHub Actions workflow that runs Uptide.
- `uptide.yml`: Uptide's settings, with a comment on each one.

## What runs, and when

The workflow has no schedule (`schedule: manual`): it runs only when someone starts it, with Run now in the Uptide dashboard or from the Actions tab (Run workflow), where you can pick a mode and one dependency. Each run:

1. Checks out `main`.
2. Sets up Node and installs your dependencies with `npm ci --ignore-scripts --no-audit --no-fund`. Install scripts of dependencies do not run.
3. Runs Uptide. It looks for dependencies that are behind, checks which of your call sites each upgrade breaks, and opens a draft pull request when it can migrate them and your compiler and tests pass. At most 3 Uptide pull requests are open at a time.

## Where it runs

In this repository's own GitHub Actions, on GitHub's runners, like your other workflows. The workflow itself only reads the repository:

- `contents: read` to check it out
- `id-token: write` to prove to Uptide that a run is this repository's workflow

With that proof, the Uptide GitHub App gives the run a token that expires within the hour, and Uptide pushes its migration branches and opens its draft pull requests with it, in this repository only. Pull requests opened that way run your CI; ones opened with the workflow's own token would not.

## What leaves the runner

- **The run report, to Uptide**, as `uptide.run/v1` JSON: which dependencies were checked, what an upgrade breaks and where (file paths, line numbers and symbol names), how verification went, and which pull requests were opened. It never contains source code, diffs or environment values. With it goes the job's OIDC token, which proves the run is this repository's workflow. [How Uptide handles your data](https://uptide-app.vercel.app/trust).
- **The npm registry**: the Uptide engine's own dependencies during setup, metadata and tarballs of the packages Uptide compares, and the public names and installed versions of your dependencies to npm's advisory endpoint.
- **GitHub**: the checkout, and the migration branches and draft pull requests Uptide pushes with the Uptide GitHub App's token.
- **Code sent to Anthropic, with this repository's own API key**, for call sites no rule can fix. The assisted fixer (the Claude Agent SDK) can read any file in the checkout to work out a fix, and what it reads goes to Anthropic with its requests. Spending stops at $1 per run (`maxCost` in uptide.yml).

## Set the API key

Uptide needs an Anthropic API key, stored as a repository secret named `ANTHROPIC_API_KEY`:

- In GitHub: Settings → Secrets and variables → Actions → New repository secret.
- Or with the GitHub CLI: `gh secret set ANTHROPIC_API_KEY`

Without the secret, the workflow does not run Uptide: the job fails and its summary says what to add. The key is passed to the Uptide step alone, never to the install step or to your tests.

## Remove Uptide

Delete `.github/workflows/uptide.yml` and `uptide.yml`, and the `ANTHROPIC_API_KEY` secret. If you installed the Uptide GitHub App, uninstall it in Settings, GitHub Apps. To not start at all, close this pull request.

## Detected in this repository

- Package manager: npm (the version on the runner)
- Lockfile: `package-lock.json`, installed with `npm ci --ignore-scripts --no-audit --no-fund`
- Node: package.json engines.node (>=20)
- Workspaces: none (a single package)
- Default branch: `main`
