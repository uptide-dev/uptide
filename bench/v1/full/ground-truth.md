# UpgradeBench v1 full bench, phase 1: ground truth

Written and committed before any phase-1 run. One section per repository in `selection.json`, with:
- the human's diff,
- the silent changes: behavior that changes and that tests and tsc don't catch, with file and line at the parent,
- the commands that define "mergeable".

Line numbers are at the parent commit.

**How it was found:** each parent was checked on a parent-only fetch, then again with only the human's `package.json` and lockfile changes applied (the "bump-only" tree). Both runs were scripts-off, TZ=UTC, on Node 22.20.0 with pnpm 10.17.1, yarn 1.22.22 and npm 11.21.0. A check the bump-only tree fails is caught by that check. A behavior change it passes is silent.

**Mergeable** means:
- Every check in `selection.json` passes, or fails exactly where the human commit fails.
- Fork CI passes, or fails only where the human commit's fails.

## 1. kukukucode/fortylove: zod 3.25.76 → 4.6.7 (#55, merged 2026-10-18 09:33Z, human)

**Human (5 files, 2 source hunks):**
- `lib/server-action-validation.ts:29`: `booleanFormValueSchema.default("false")` → `.default(false)`. Zod 4's `.default` takes the output type and skips parsing.
- `lib/server/action-input.ts:4`: `z.ZodTypeAny` → `z.ZodType`.
- A regression test that `remove_document` stays opt-in.

**Bump-only:** tsc fails with `lib/server-action-validation.ts(29,51): error TS2769`. Lint and all 118 tests pass.

**Silent changes: none.** The one behavior change the human made, `.default`, is caught by tsc.
- Informational, not scored: Zod 4's stricter `.uuid()` (`lib/input-validation.ts:27`) and `.email()` (`lib/ops-policy.ts:4`, `lib/server-action-validation.ts:84`). The human kept both as they were.

**Mergeable:** `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`. All pass at the parent.

## 2. raouf-b-dev/ecommerce-store-api: redis 5.8.0 → 6.3.0 (#310, merged 2026-10-17 20:31Z, Dependabot + 3 human commits)

**Human:**
- `src/infrastructure/redis/redis.service.ts`: drops the `AppRedisClient` alias and the `as AppRedisClient` cast. Imports `RedisJSON` from `redis`, not `@redis/json/dist/lib/commands`.
- `eslint-suppressions.json`: suppression count 3 → 2.
- `package.json`: an `overrides.typeorm.redis` entry.
- `redis-connection.options.ts:25`: a doc line, "Uses redis@6 defaults (RESP 3, …)". The human accepted RESP3 and said so at the options builder.

**Bump-only:** tsc, build and all 1,724 tests pass. Lint fails (`redis.service.ts:52`, `no-unnecessary-type-assertion`), so lint catches the cast.
- Run without its cache: `lint:check` uses `--cache`, and a warm `.eslintcache` passed it.

**Silent change, 1 site (`redis-resp3-default`):**
- redis 6 connects with RESP3 by default, redis 5 with RESP2. No test or type error shows it.
- Every client is built from `buildNodeRedisClientOptions` (`src/infrastructure/redis/redis-connection.options.ts:21-40`). Its two callers are `createClient` in `redis.service.ts:52-54` and `websocket/adapters/redis-io.adapter.ts:25-27`.
- **Caught** if the run either:
  - pins the protocol (`RESP: 2` or `RESP: 3`) in the builder or at either call, or
  - names the RESP3 change in its summary or PR body.

**Mergeable:** `npm run typecheck`, `npm run lint:check`, `npm test`, `npm run build`. All pass at the parent.

## 3. guardian/support-dotcom-components: typescript 5.9.3 → 6.0.3 (#1856, merged 2026-10-19 13:59Z, Dependabot + 11 human commits)

The parent is the merge's first parent, `4a256bf`.

**Human, configuration only:**
- Root `eslint.config.mjs`: `reportUnusedDisableDirectives: 'warn'`, and 5 `no-unsafe-*` rules turned off "when moving typescript from 5.9.3 to 6.0.3".
- `cdk/eslint.config.mjs`: `no-unsafe-call` and `no-unsafe-member-access` off.
- `cdk/tsconfig.json`: `"types": ["jest", "node"]`. TS 6 no longer includes every `@types` package.
- Both `package.json` files bump typescript.
- Coverage counts the two eslint configs. tsconfig isn't a code file.

**Bump-only:**
- Root tsc, lint, prettier, 620 tests and build pass.
- `cdk` lint fails (`no-unsafe-call`, "type that could not be resolved"), so lint catches it.
- `cdk`'s own `tsc` fails with TS5107 (`moduleResolution=node10` deprecated). It fails the same way on the human commit, which also fails TS2688. CI never runs it, so it isn't a check.

**Silent changes: none.**
- Every tsconfig sets `target` and `module` explicitly, so TS 6's new defaults change no output.
- The server and dotcom builds are esbuild and rollup, not tsc.

**Mergeable:** CI's commands.
- `pnpm tsc`.
- `pnpm lint && pnpm prettier:check && pnpm --dir cdk lint && pnpm --dir cdk prettier:check`.
- `pnpm test`, TZ=UTC: 8 of 620 fail in America/Los_Angeles.
- `NODE_ENV=production pnpm build-server && pnpm build-dotcom && pnpm --dir cdk synth`.
- All pass at the parent.
- `cdk`'s jest snapshot fails at the parent and on the human commit, so it isn't a check.

## 4. stakwork/strut: ai 6.0.235 → 7.0.105 (#11, merged 2026-09-18 04:13Z, human)

The commits are by Evanfeenstra, with a `Co-Authored-By: Claude` trailer. See the human clause in `../repos.md`.

**Human (8 files):**
- v7 names: `stepCountIs` → `isStepCount`, `onFinish` → `onEnd`, `onStepFinish` → `onStepEnd`, `fullStream` → `stream`, `totalUsage` → `usage`.
- `generateObject` → `generateText` with `Output.object` (`src/steps/core/llm.ts`).
- `result.response.messages` → `result.responseMessages`, at every place that keeps a run's messages.
- A test that matches the socket error anywhere on the cause chain.
- Companion bumps: `@ai-sdk/anthropic` 3 → 4, `aieo` 0.1 → 0.2, zod 4.3 → 4.6.

**Bump-only:**
- tsc passes: ai 7.0.105 keeps every v6 name as a deprecated alias.
- 812 of 813 tests pass. `src/steps/core/agent.test.ts` "mid-stream socket death is resumed, not lost" fails, so the tests catch the error-wrapping change.

**Silent changes, 4 sites (`ai-response-final-step`):**
- In ai 7, `result.response` is "Additional response information from the last step", deprecated in favor of `finalStep.response`. In v6, its messages spanned every step. The accumulated messages are `responseMessages`.
- With only the bump, these keep only the last step's messages: tool calls and results from earlier steps are dropped. tsc and the tests pass.

| site | what drops steps |
|---|---|
| `src/createStrut.ts:1796-1797` | `const resp = await result.response; chatStore.appendMessages(chatId, resp.messages)`: the saved chat history |
| `src/steps/core/agent.ts:1104` (set at `:1068-1075`) | `res.response?.messages`: the agent step's messages, returned with `returnMessages` |
| `src/steps/core/agent.ts:1168` | `(await nudged.response)?.messages`: the schema nudge continuation |
| `src/steps/core/agent.ts:1261` | the same, in the final-answer nudge continuation |

- **Caught at a site** if the run's diff touches it and the file at its head uses `responseMessages`, or if the summary or PR body names the final-step change (`final step`, `last step` or `responseMessages`).
- Not a site: `agent.ts:974` (`sf.response?.messages` in the step callback) is per-step in v7. The human changed only its comment there.

**Mergeable:** `yarn tsc --noEmit`, `npm test`, `yarn tsc` (the build). There's no lint script. All pass at the parent: 813 tests.

## 5. yea-protocol/yea: stripe 22.6.2 → 23.0.0 (#268, merged 2026-10-16 00:22Z, human)

It supersedes Dependabot's #259. The commit is by solomonjames, with a `Co-Authored-By: Claude Opus 5.5` trailer.

**Human:**
- `connectors/stripe/src/api/client.ts:16`: `STRIPE_VERSION` `'2026-08-26.dahlia'` → `'2026-09-30.endive'`. It's typed `Stripe.LatestApiVersion`, so the build fails until it's moved.
- Tests follow the new version string.
- A new `api.test.ts` case: a response cut off mid-body is now `StripeConnectionError` in stripe-node 23, and the existing retry and error mapping still report a write as maybe-applied. No source change was needed for it.

**Bump-only:** the build fails with `src/api/client.ts(16,14): error TS2322: Type '"2026-08-26.dahlia"' is not assignable to type '"2026-09-30.endive"'`. The other workspaces' tests pass. Lint passes.

**Silent changes: none.** The human checked the cut-off-body change with a test and found the existing mapping covers it.

**Mergeable:**
- `npm run lint && npm run lint:style && npm run lint:structure`.
- `npm run build && npm test`: the tests read `ts/dist`, as CI's `npm ci && npm run build && npm test` does.
- `npm run build`.
- All pass at the parent: 258 + 242 + 210 + 90 tests.
