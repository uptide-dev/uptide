# UpgradeBench v1 secondary set (phase 2): ground truth

The headline set. It was written and committed before any secondary run, in the same structure as `../full/ground-truth.md`. Each section has:
- the human's diff,
- the silent changes, with file and line at the parent,
- the commands that define "mergeable".

**How it was found:**
- Each parent was checked on a parent-only fetch, with lifecycle scripts off, TZ=UTC, Node 22.20.0, npm 11.21.0 and pnpm 10.24.0.
- `ANTHROPIC_API_KEY`, `OPENAI_API_KEY` and `ANTHROPIC_BASE_URL` were removed from the environment. This machine's `~/.zshrc` exports both keys, and one repository's tests call the API when a key is present.
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

## 2. davide-pi/matrimonio-elena-e-davide: tailwindcss 3.4.19 → 4.3.3 (#30, merged 2026-10-14 21:01Z, human)

The commit is by Davide Piccinini, with a `Co-Authored-By: Claude AI` trailer and a `Claude-Session:` link. **No pack** in Uptide 0.18.2.

**Human (14 files):**
- `package.json`: tailwindcss `^3.4.1` → `^4.3.3`, adds `@tailwindcss/vite`, drops `autoprefixer`.
- `postcss.config.js` deleted. `vite.config.ts` adds `tailwindcss()`.
- `src/index.css`:
  - `@tailwind` directives become `@import 'tailwindcss'` + `@config '../tailwind.config.js'`.
  - A base layer restores v3's `gray-200` default border color.
  - 5 `@layer utilities` classes become `@utility`.
- Class renames in 8 components:
  - `backdrop-blur-sm` → `-xs`, `shadow-sm` → `shadow-xs`.
  - `bg-gradient-to-b` → `bg-linear-to-b`.
  - `z-[n]` → `z-n`.
- `src/test/SpouseContactCard.test.tsx:77`: the expected class follows.

**Bump-only:** not built. With only the manifests applied, Tailwind 4's PostCSS entry refuses the v3 `postcss.config.js` ("use @tailwindcss/postcss"), so the build catches the config change. The scale renames below are what a minimal config fix leaves behind: v3 class names that still exist in v4 at a different size. Lint, tests (jsdom, which asserts class names) and the build all pass with them.

**Silent changes, 8 sites, 9 classes (`tailwind4-scale-rename`):**

| site | v3 class | v4 equivalent |
|---|---|---|
| `src/components/CountdownTimer.tsx:111` | `backdrop-blur-sm` | `backdrop-blur-xs` |
| `src/components/RSVP.tsx:10` | `backdrop-blur-sm` | `backdrop-blur-xs` |
| `src/components/EventDetails.tsx:42` | `backdrop-blur-sm` | `backdrop-blur-xs` |
| `src/components/EventDetails.tsx:102` | `shadow-sm` | `shadow-xs` |
| `src/components/LanguageSelector.tsx:21` | `backdrop-blur-sm` | `backdrop-blur-xs` |
| `src/components/Gift.tsx:22` | `backdrop-blur-sm` | `backdrop-blur-xs` |
| `src/components/Gift.tsx:29` | `backdrop-blur-sm` and `shadow-sm` | both `-xs` |
| `src/components/SpouseContactCard.tsx:7` | `shadow-sm` | `shadow-xs` |

- Not a site:
  - `bg-gradient-to-b`: v4 keeps it as an alias.
  - `z-[0]`, `z-[10]`, `z-[50]`, `z-[60]`: arbitrary values render the same.
  - The `space-y-*` selector change and `hover:` on touch devices: the human kept them, so they're informational.
- **Default border color:** the only bare `border` (`CountdownTimer.tsx:111`) has an explicit `border-sage-200`, so it's not a site. The human's compatibility layer covers the rest.

**Mergeable:** CI's commands: `npm ci --ignore-scripts`, `npm run lint`, `npm run test:coverage` and `npm run build`. All pass at the parent: 69 tests in 14 files. `tsc -b --noEmit` passes too, but CI doesn't run it.

## 3. riseup-oss/mcp: jest 29.7.0 → 30.5.2 (#13, merged 2026-10-19 09:00Z, human)

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

## 4. davide-pi/wedding-uploads-elena-e-davide: tailwindcss 3.4.19 → 4.3.3 (#15, merged 2026-10-14 20:58Z, human)

The same author and day as repository 2, with a `Co-Authored-By: Claude AI` trailer. It's a sibling site, with its own code and tests. **No pack.**

**Human (21 files):**
- `package.json`: tailwindcss `^4.3.3`, adds `@tailwindcss/vite`, drops `autoprefixer`.
- `postcss.config.js` deleted. `vite.config.ts` adds `tailwindcss()`.
- `tailwind.config.js` deleted (123 lines), and the theme moves to `@theme` in `src/index.css`, with the gray-200 border compatibility layer.
- Class renames in 12 components:
  - `backdrop-blur-sm` → `-xs`, `blur-sm` → `blur-xs`, `blur-0` → `blur-[0px]`.
  - `rounded-sm` → `rounded-xs`, `rounded` → `rounded-sm`.
  - `outline-none` → `outline-hidden`.
  - `flex-shrink-0` → `shrink-0`, `bg-[length:…]` → `bg-size-[…]`.
  - `bg-gradient-to-*` → `bg-linear-to-*`.
- `vitest.config.ts` reworked (48 lines).

**Bump-only:** as in repository 2, the build catches the PostCSS entry. These scale and behavior renames pass lint, tests and the build unchanged.

**Silent changes, 21 sites:**
- **`tailwind4-scale-rename`, 16 sites:**
  - `backdrop-blur-sm`, 10: `src/components/MediaCard.tsx:67`, `:111`, `:141`; `MediaModal.tsx:43`, `:50`; `MediaCardSkeleton.tsx:36`; `LanguageSelector.tsx:63`, `:72`; `EmptyMediaState.tsx:10`; `Header.tsx:9`.
  - `blur-sm`, 3: `src/components/MediaCard.tsx:102`, `:123`, `:132`.
  - `rounded-sm` → `rounded-xs`, 1: `src/components/MediaModal.tsx:62`.
  - Bare `rounded` → `rounded-sm`, 2: `src/components/MediaCardSkeleton.tsx:58`, `:63`.
- **`tailwind4-outline-none`, 5 sites:** `src/components/buttons/ActionButton.tsx:25`, `Notification.tsx:44`, `buttons/FloatingActionButton.tsx:91`, `upload/MediaUploadForm.tsx:141`, `:158`.
  - v3's `outline-none` was a transparent 2px outline, still drawn in forced-colors mode. v4's is `outline-style: none`, so keyboard focus disappears there. `outline-hidden` keeps v3's behavior.

**Mergeable:** CI's commands: `npm ci --ignore-scripts`, `npm run lint`, `npm run test:coverage` and `npm run build`. All pass at the parent: 52 tests, 3 skipped. Lint has 1 warning, no errors.

## 5. AKogut/ai-flaky-test-triage: vitest 4.1.10 → 5.0.5 (#206, merged 2026-10-20 14:32Z, human)

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
