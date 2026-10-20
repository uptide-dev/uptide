# UpgradeBench v1 secondary set (phase 2): ground truth

The headline set. It was written and committed before any secondary run, in the same structure as `../full/ground-truth.md`. Each section has:
- the human's diff,
- the silent changes, with file and line at the parent,
- the commands that define "mergeable".

**How it was found:**
- Each parent was checked on a parent-only fetch, with lifecycle scripts off, TZ=UTC, Node 22.20.0, npm 11.21.0 and pnpm 10.24.0.
- `ANTHROPIC_API_KEY`, `OPENAI_API_KEY` and `ANTHROPIC_BASE_URL` were removed from the environment. This machine's `~/.zshrc` exports both keys, and one repository's tests call the API when a key is present.
- **Replacements:** the two davide-pi sites were dropped by the user's amendment (`../repos.md`). Their sections are removed, and sections 4 and 5 are the replacements, from the continued procedure.
- Where noted, the parent was checked again with only the human's `package.json` and lockfile applied (the bump-only tree).
- A behavior change that the bump-only tree's checks pass is silent.

**Mergeable** is phase 1's bar, with phase 1's two later rules (`../full/results.md`, "Summary"):
- Every check below passes, or fails exactly where the human commit fails.
- Fork CI passes, or fails only where the human commit's fails.
- A check that only validates the PR description's format is out of the bar.
- A change the upgrade doesn't require makes a run "not mergeable without edits".

Silent sites are scored as in phase 1. **Caught by edit** means the run's diff touches the site and the file at its head matches `keep`. **Caught by mention** means the summary or PR body matches `mention`. Mention is looser than the brief and is reported apart.

## 1. onideus/context-library: zod 3.25.76 → 4.6.7 (#300, merged 2026-10-19 21:40Z, human)

The commit is by Zach Martin, with a Claude Fable 5.1 co-author trailer, and the PR body ends "Generated with Claude Code". It supersedes Dependabot #275 (zod) and #295 (MCP SDK). Uptide 0.18.2 has a **verified** zod pack.

**Human (5 files):**
- `package.json`:
  - zod `^3.25.0` → `^4.6.7`.
  - `@modelcontextprotocol/sdk` `^1.27.1` → `^1.32.1`, a minor (an advisory fix).
  - `overrides.fast-uri` 3.1.7 → 3.1.8, a patch.
- `qs` 6.16.0 → 6.16.1 in the lockfile.
- Zod 4's `z.record()` needs an explicit key schema. Three call sites change from `z.record(z.unknown())` to `z.record(z.string(), z.unknown())`:
  - `src/sync/routes.ts:678`
  - `src/tools/artifacts.ts:260`
  - `src/tools/artifacts.ts:558`
- One comment in `src/config.ts:115`.
- The PR body says the human checked the built server's `tools/list` under zod 4: all 32 tools still return an object schema.

**Bump-only:** the build (`tsc`) fails with `TS2554: Expected 2-3 arguments, but got 1` at the three `z.record` sites, so tsc catches them. With Postgres, all 866 tests pass, 1 skipped.

**Silent changes: none scored.** These are informational, as fortylove's were. The human kept each one as it was:
- **Validation errors returned to sync clients:**
  - `src/sync/routes.ts:1178` returns `parsed.error.issues` in the 400 body.
  - `src/sync/routes.ts:934` returns a per-op `ZodError`'s `message`.
  - Zod 4 renames issue codes (`invalid_enum_value` → `invalid_value`), drops `received`, and rewrites every default message (for example "Expected string, received number" → "Invalid input: expected string, received number").
  - This was checked by parsing the same invalid push with `zod@3.25.76` and `zod@4.6.7`. No test asserts the shape.
- **MCP tool `inputSchema`:** the SDK switches to zod 4's own JSON Schema converter. Records render as `propertyNames` + `additionalProperties`, and `.uuid()` as `format` + `pattern`. The human checked this by hand.
- **`.uuid()`:** `src/tools/entity-tools.ts:410`, `:411` and `:642` are stricter in zod 4 (RFC 4122 variants only).

**Mergeable:**
- `npm ci --ignore-scripts`, `npm run build` (`tsc` + migrations copy), and `npm test` against Postgres. All pass at the parent: 866 tests, 1 skipped.
- **Postgres:** CI's service is `pgvector/pgvector:pg16`, with `cl_test`/`cl`/`test`. Locally it runs on port 55432. Without it, 360 tests skip.
- No lint script.
- CI also runs a Snyk scan on push to main only, not on PRs.

## 2. riseup-oss/mcp: jest 29.7.0 → 30.5.2 (#13, merged 2026-10-19 09:00Z, human)

The commits are by Revital Oren, with Claude Opus 5.5 co-author trailers. **No pack** in Uptide 0.18.2.

**Human (4 files, no source change):**
- `package.json`:
  - jest 29.7.0 → 30.5.2 and `@types/jest` 29.5.14 → 30.0.0.
  - `@modelcontextprotocol/sdk` 1.29.0 → 1.32.1, a minor.
  - The `hono` override 4.12.26 → `^4.13.7`.
- `.github/workflows/ci.yml` pins two actions to commit SHAs.
- A new `.github/dependabot.yml`.

**Bump-only:** equal to the human commit, since no source file changed. The human commit's checks are run as the reference.

**Silent changes: none.**
- The code under test doesn't use jest. Jest 30's changes (removed matcher aliases, `--testPathPattern` → `--testPathPatterns`, stricter `jest.mock` hoisting) can only break the test run, and the tests would catch that.
- The test script runs jest through `node --experimental-vm-modules` with `jest.config.js`, unchanged by the human.

**Mergeable:** CI's commands.
- `npm ci --ignore-scripts`, `npm run lint` (`tsc --noEmit`), `npm test` and `npm run build`. All pass at the parent: 34 tests in 2 suites.
- CI also runs `npm audit --audit-level=high`. Its result depends on the advisory database on the day, so fork CI is compared with the human commit's fork CI run at the same time.

**Unrelated-changes note:** the human's CI and Dependabot edits aren't required by the upgrade. A run that leaves them out isn't penalized: coverage counts them, but the mergeable bar doesn't. A run that adds unrelated workflow changes is judged by hand.

## 3. AKogut/ai-flaky-test-triage: vitest 4.1.10 → 5.0.5 (#206, merged 2026-10-20 14:32Z, human)

The commit is by Andrii Kohut, with no AI trailer. It supersedes Dependabot #203, whose CI failed. Uptide 0.18.2 has a **verified** vitest pack.

**Human (14 files):**
- `package.json`: vitest and `@vitest/coverage-v8` 4.1.10 → 5.0.5. `@playwright/test` 1.62.1 → 1.64.1, a minor.
- **Reporter fixtures:** regenerated by running the real reporters (`tests/fixtures/reporters/vitest-5.0.5.json`, `playwright-1.64.1.json`), with the specs they come from now committed under `tests/fixtures/reporters/source/`.
- Five tests read the new fixture names:
  - `contracts/reporters/vitest.test.ts:10`
  - `contracts/reporters/playwright.test.ts:20`
  - `tests/unit/analyze.test.ts:34`, `:37`
  - `tests/unit/reporter-contract.test.ts:62`, `:65`, `:137`
- `eslint.config.js` ignores the fixture sources.
- No change in `contracts/reporters/vitest.ts`. The human checked that no field the normalisers read was removed or renamed: vitest 5 adds a `benchmarks` array, and its stack frames point into vitest's bundled chunks.

**Bump-only:** typecheck and lint pass. `test:coverage` fails 2 tests, both in `tests/unit/reporter-contract.test.ts` "pinned reporter versions": a pinned reporter needs a fixture of its exact version. So the tests catch the bump, and the fix is generating fixtures by running vitest 5 and Playwright 1.64.

**Silent changes: none scored.** `normaliseVitestReport` splits message and stack at the first `    at ` frame and filters no frame by path. So the frame paths vitest 5 moved don't change what it keeps. Informational: the golden dataset's recorded runs (`eval/golden-dataset/*.run.json`) still carry vitest 4 frames, and the human left them.

**Mergeable:**
- `npm ci --ignore-scripts`, `npm run typecheck`, `npm run lint && npm run format:check`, `npm run test:coverage && npm run demo`, and `npm run build`. All pass at the parent with the API keys unset: 1966 tests in 68 files.
- **With `ANTHROPIC_API_KEY` set,** `eval/cli.test.ts` "exits 1 when the agent classifier has no cassette to replay" calls the live API and fails. It got HTTP 400, `output_config.format.schema: For 'number' type, properties maximum, minimum are not supported`. `npm run demo` also calls it and exits 1. `check.sh` therefore runs every check with both keys unset.
- **Out of the bar:** `npm run test:e2e` (Playwright, Chromium). CI runs it with `continue-on-error: true`, and the suite is deliberately flaky: it's the tool's own input. At the parent, 2 of 73 fail (`find-by-name.spec.ts:89`, `visible-tasks.spec.ts:74`).
- **Fork CI:** the eval gate needs `origin/main` history and the committed cassettes. Fork CI is compared with the human commit's.

## 4. MMM-pay/payflow-backend: express 4.22.2 → 5.3.0 (#102, merged 2026-10-17 19:23Z, human)

The commits are by Gabbydunkk, with no AI trailer. It's an organization repository, the Payflow protocol's indexer, keeper and REST API. Uptide 0.18.2 has a **verified** express pack.

**Human (5 files, squash-merged as `1e659347`):**
- `package.json`: express `^4.21.2` → `^5.3.0`, `@types/express` `^4.17.21` → `^5.0.6`.
- `src/app.ts`:
  - The inline four-argument error middleware (`src/app.ts:139-142` at the parent) becomes an exported `errorHandler`. It hands back an error whose headers are already sent, and logs `loggableError(err)`: a fresh error with only the type, message, stack and status, so body-parser's `err.body` never reaches a log line.
- `test/api.test.ts`: 5 new tests for that boundary.
- `CHANGELOG.md`: an entry.

**Bump-only:** typecheck, lint, all 139 tests and the build pass. Nothing is caught.

**Silent changes: none scored.** The human's own change is not a migration the upgrade requires:
- **The error-boundary hardening:** checked on a minimal app with `express.json()` and the same middleware, under `express@4.22.2` and `express@5.3.0`. A truncated JSON POST reaches the error middleware as a `SyntaxError` carrying `body` (the raw request) under **both**. The log leak predates the upgrade.
- **Async rejections:** every route handler is synchronous, and the two async admin handlers (`src/routes/admin.ts:63`, `:72`) catch their own errors. So Express 5's forwarding of rejected promises changes no route here.
- A run that adds the hardening is judged related (the human did it). A run that doesn't isn't penalized beyond coverage.

**Informational, not scored** (the human kept it as it was):
- **The query parser:** Express 5's default query parser is `simple` (Node's `querystring`), not `extended` (`qs`). `GET /api/mandates?ids[]=1&ids[]=2` filtered by id under Express 4: `qs` gives `["1","2"]`, and `parseIds` (`src/routes/mandates.ts:21`) reads `String(raw)` = `"1,2"`.
  - Under Express 5 the key is `ids[]`, `ids` is undefined, and the route returns every mandate up to `limit`. The tests use only `?ids=1,2`.
  - `?ids=1&ids=2` behaves the same under both.

**Mergeable:** CI's commands: `npm ci --ignore-scripts`, `npm run typecheck`, `npm run lint`, `npm test` and `npm run build`. All pass at the parent: 139 tests, in seconds, no service.

## 5. opena2a-org/aicomply: jest 29.7.0 → 30.5.2 (#179, merged 2026-10-16 00:49Z, human)

The commit is by Abdel Fane (thebenignhacker), with no AI trailer. It's an organization repository. **No pack** in Uptide 0.18.2.

**Human (4 files):**
- `package.json`: jest `^29.7.0` → `^30.5.2`, `@types/jest` `^29.5.0` → `^30.0.0`, ts-jest `^29.1.0` → `^29.4.15` (a minor, for jest 30).
- `src/__tests__/lint-windows-paths.test.ts`: jest 30 keys a core module's mock by its id **without** the `node:` prefix. The three `jest.mock('node:path…')` calls go, and the mocks of `path`, `path/posix` and `path/win32` now also answer the `node:` ids.
- `src/__tests__/dev-dependency-advisories.test.ts`: new. It asserts advisory floors on the lockfile, which the PR's lockfile refresh meets. It isn't required by the upgrade, and a run without it isn't penalized beyond coverage.

**Bump-only:** lint (`tsc --noEmit`) and the build pass. `npm test` fails `src/__tests__/lint-windows-paths.test.ts` (836 of the rest pass), so the tests catch the mock-keying change.

**Silent changes: none.** Jest 30's changes affect only how tests run, and the tests catch the one that matters here.

**Mergeable:** `npm ci --ignore-scripts`, `npm run lint`, `npm test` and `npm run build`. All pass at the parent: 851 tests in 37 suites, 10 s, no service.
- The repository has no PR workflow that runs the tests: they run in `release.yml` on release. So fork CI is compared with the human commit's, and the local checks are the bar.
