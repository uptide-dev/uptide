# openai 4 → 7: evidence and verification limits

Read date for every source below: **2026-10-14**. Scope: `openai` (openai-node) `>=4 <5` to
`>=7 <8`; sources pinned at tag **v7.32.0** (7.33.0 was published the same day and is not
read). Status: **candidate**. The pack's own rules and detectors add no false positive on
seven public upgrades, but the gate is not met: `check` itself reports four breaking sites
that the ground truth excludes, and leaves behind packages two of the real upgrades moved.
Both are engine gaps (below), not rule errors. No engine change is part of this pack.

## Source ledger

- [MIGRATION.md at v7.32.0](https://github.com/openai/openai-node/blob/v7.32.0/MIGRATION.md):
  the 4 → 5 guide, kept current; at v7.0.0 it raised the runtime floor to Node.js 22 and
  dropped the "Migration CLI" section (the `openai migrate` codemod was removed in 6.x:
  changelog "remove migrate CLI"). Compared with
  [v5.0.0](https://github.com/openai/openai-node/blob/v5.0.0/MIGRATION.md),
  [v6.0.0](https://github.com/openai/openai-node/blob/v6.0.0/MIGRATION.md) and
  [v7.0.0](https://github.com/openai/openai-node/blob/v7.0.0/MIGRATION.md): the later copies
  only add newer endpoints to the same lists (admin, skills, videos, chatkit).
- [CHANGELOG.md at v7.32.0](https://github.com/openai/openai-node/blob/v7.32.0/CHANGELOG.md),
  every entry from 4.104.0 to 7.32.0, and the release notes of
  [5.0.0](https://github.com/openai/openai-node/releases/tag/v5.0.0),
  [5.12.1](https://github.com/openai/openai-node/releases/tag/v5.12.1),
  [6.0.0](https://github.com/openai/openai-node/releases/tag/v6.0.0),
  [7.0.0](https://github.com/openai/openai-node/releases/tag/v7.0.0).
- Published packages (read with `npm pack`, nothing executed): openai 4.104.0, 5.0.0,
  5.11.0, 5.12.0, 5.12.1, 6.0.0, 6.49.0, 7.0.0, 7.32.0; their `package.json` (engines, peers,
  exports) and `.d.ts` (every signature quoted below).

## One pack, not three

| Major | Breaking entries in its changelog | What it changes for 4.x code |
| --- | --- | --- |
| 5.0.0 (2025-05-29) | the whole MIGRATION.md (built-in fetch, named path params, renamed methods, removed shims/helpers, beta chat promoted) | almost everything below |
| 6.0.0 (2025-09-30) | one: `ResponseFunctionToolCallOutputItem.output` and `ResponseCustomToolCallOutput.output` become `string \| Array<…>` | one type widening |
| 7.0.0 (2026-07-27) | one: "require Node.js 22 and codify version support" (`engines.node >=22.0.0`) | the runtime floor |

Between majors, 5.12.1 turned `ChatCompletionMessageToolCall` and `ChatCompletionTool` into
function | custom unions (checked: 5.12.0 has interfaces, 5.12.1 the unions), and 6.0.0's
manifest widened the zod peer from `^3.23.8` to `^3.25 || ^4.0`. No later major reverts or
re-renames anything 5.0 introduced, the guide is one document for the whole range, and the
public upgrades found all jump 4.x → 7.x directly (npm mining found ten packages whose
published manifests went `^4` → `^7` with nothing in between). A split would only serve 5.x
and 6.x installs, which the queue entry does not cover; they keep the generic tier. One pack.

## Classified changes

**M** mechanical rule (rewrite, declines when ambiguous) · **A** assisted rule (guide for the
agent; options surface in "Decisions for you") · **B** behavior note (finding with `detect`,
or decision with repository evidence) · **N** not compiler-visible and not covered.

| Change (source) | Class | Treatment |
| --- | --- | --- |
| Named path params: `runs.retrieve(threadId, runId)` → `runs.retrieve(runId, { thread_id })`: the 25 methods of the guide's list that exist in 4.x, plus 3 it omits (guide; types) | M `named-path-params` | Rewrites only inert arguments (names, members, literals) and an unambiguous third argument; a body merges into the params. `runs.poll`, `submitToolOutputsAndPoll`, `submitToolOutputsStream` changed too although the guide's list omits them (7.32 `.d.ts`). Syntactic detect also sees clients typed `any`. |
| `del()` → `delete()`, 14 methods (guide) | M `delete-method` | Rename; multi-id resources reshape as above. A bare `files.del` is detected only on a known client (other libraries have `del`). |
| `beta.chat.completions.parse/stream/runTools` → `chat.completions.*` (guide) | M `beta-chat` | Rename of the chain; `?.beta` declines. |
| Beta chat types moved to `openai/resources/chat/completions` (guide) | M `removed-modules` | Only when every imported name exists at the new path (the runFunctions types do not). |
| `openai/shims/*` removed (guide) | M `removed-modules` + B `global-types` | A side-effect import alone on its line is deleted; named imports are the agent's. |
| `openai/src/*` removed (guide) | M `removed-modules` | `openai/src` and `openai/src/index` → `openai`; deeper paths are the agent's. |
| `openai/core` refactored, `APIClient` removed (guide) | A `removed-modules`, `removed-exports` | Guide names the replacements. |
| `openai/error`, `pagination`, `resource`, `streaming`, `uploads` → `openai/core/*` (guide) | M `core-paths`, deprecated | 7.32 still ships the old paths as `@deprecated` re-exports, so they compile: deprecated, applied with `--include-deprecated`. |
| `uploads` internals removed (`fileFromPath`, `BlobLike`, `createForm`, …) (guide) | A `removed-exports`, `file-from-path` | `fileFromPath` offers two options (stream, or `toFile` keeping the name): the choice goes to decisions. |
| Removed request-options overloads: `list({ headers })` → `list({}, { headers })` (guide) | M `request-options` | 7.x types those params with request-option keys as `?: never`, so the compiler message does not name the key: found syntactically (literal of request-option keys only, on an SDK resource). |
| `httpAgent` removed for `fetchOptions` (guide) | A `http-agent` + B `builtin-fetch` | Three options (undici `ProxyAgent` dispatcher, undici `Agent`, custom fetch): the choice goes to decisions. The note names proxy/agent dependencies and a global dispatcher, which now applies to OpenAI traffic. |
| `withResponse`/`asResponse` return Web `Response`; `body` is a `ReadableStream` (guide) | B `web-response` (finding) | Detects `body.pipe/on/read`, `headers.raw()`, `buffer()` on names bound to those calls, typed or not. |
| `APIError.headers` is a Web `Headers` (guide) | B `error-headers` (finding) | `catch (e) { e.headers['x'] }` is blind to the compiler (catch bindings are `any`/`unknown`; non-strict code compiles); detected syntactically. |
| Path params URI-encoded (guide) | B `encoded-path-params` (finding) | `encodeURIComponent(...)` passed to an SDK method is now encoded twice. |
| Zod helpers throw on optional-only fields (guide) | B `zod-helpers` (decision) | Evidence: files importing `openai/helpers/zod`; also a declared zod below the 6.0 peer range. |
| Pagination `nextPageParams()`/`nextPageInfo()` → `nextPageRequestOptions()` (guide) | A `page-helpers` | Detected by name (any receiver). |
| Page classes become type aliases (guide) | A `page-classes` | Compiler TS2693. |
| `runFunctions` removed (guide) | A `run-functions` | Guide maps `functions` to `tools` and `function_call` to `tool_choice`. |
| runTools events/methods `functionCall*` → `functionToolCall*` (guide) | M `runner-renames` | String literals in `.on/.once/.off/.emitted` and the two methods; payloads keep their shape (checked). |
| Resource classes from the package root in CommonJS (guide) | N | Runtime-only in CJS, never valid in types; named in the `also-review` decision. |
| Tool calls and tools are function \| custom unions (5.12.1) | A `tool-call-union` | Narrow on `type`; the custom case must be decided, never cast. |
| Function/custom tool call outputs widen (6.0.0) | A `function-output-union` | Handle the array case. |
| Node.js 22, TypeScript 4.9 minimum (7.0.0; guide) | B `platform-minimums` (decision) | Evidence from engines, `.nvmrc`/`.node-version`, CI `node-version`, declared TypeScript. |
| Global fetch types needed: DOM lib or `@types/node >= 20` (guide, "TypeScript troubleshooting") | B `global-types` (decision) | Evidence from tsconfig `lib` and `@types/node`. |
| `withOptions()` clones by calling the class with client options only (5.0.0 "add withOptions helper"; `client.js` 7.32) | B `client-subclass` (decision) | Evidence: a class extending `OpenAI`/`AzureOpenAI`. Not in the guide; read from the shipped code. |
| `exports` went from `./*` (4.104) to 68 explicit subpaths (7.32; changelog "stop using path fallbacks") | `requiresBuild: true` | A deep import (`openai/internal/...`) that `moduleResolution: node` still resolves from disk fails in Node or a bundler; only the build shows it. |
| zod peer `^3.23.8` → `^3.25 \|\| ^4.0` (6.0.0 manifest) | B `zod-helpers` | Engine gap: `check` does not move it (below). |
| Assistants API deprecated (changelog "mark assistants as deprecated") | N | API lifecycle, not an SDK change. |

**Release group and companions: none.** The openai-node repository publishes `openai` only.
`@openai/agents` depends on `openai` (0.1.3: `^5.20.2`; 0.17.2: `^7.2.0`) as a regular
dependency, on its own 0.x line: it is not released in lockstep and needs no entry. Peers of
7.x: `ws`, `zod`, `@smithy/*`, `@aws-sdk/credential-provider-node`, `undici` (7.32), all
optional.

## Ground truth

Found by web search for merged Dependabot/Renovate/manual 4.x → 7.x upgrades and by mining
npm: two keyword sweeps of the registry search (3,516 and 2,695 package names, overlapping), of which ten published `openai ^4` then `^7`.
Each parent was installed from its lockfile with scripts off, and drafted with
`pnpm packs:truth` (and `--also` for what the upgrade moved because of openai). Sites were
read and assigned by hand, **before the pack was scored**, and not changed afterwards.

| Repository | Parent | Upgrade | Versions | Expected |
| --- | --- | --- | --- | --- |
| [zeikar/charivo](https://github.com/zeikar/charivo/compare/b9a476d9acb59f473e08f0e97ce6e91dc2201d99...67ae240f175f166ca0d7c5e79c1ea160e09ef133) | `b9a476d9` | `ef509fde` + `67ae240f` | 4.104.0 → 7.10.0 | 3 `tool-call-union` (TS2339, TS18046, a changed signature) |
| [openai/openai-guardrails-js#122](https://github.com/openai/openai-guardrails-js/pull/122) | `6c13ba08` | `a1b81722` | 4.104.0 → 7.9.0, with `@openai/agents` 0.17.2, zod 4.5.4 | 1 TS2345 (AzureOpenAI options) + 10 changed runs of a client-subclass rework, `generic` |
| [wardby/wardby#231](https://github.com/wardby/wardby/pull/231) | `d46ec64d` | `edc5f3d2` | 4.104.0 → 7.30.0 | 2 optional type cleanups, `generic` |
| [csnyder256/ux-struggle-detector#11](https://github.com/csnyder256/ux-struggle-detector/pull/11) | `b7308489` | `de8f29dd` | 4.104.0 → 7.23.0 | 2 `max_tokens` → `max_completion_tokens`, `generic` |
| [grantsingleton/batch-ai#14](https://github.com/grantsingleton/batch-ai/pull/14) | `05c7e9f1` | `0470d510` | 4.83.0 → 7.4.0, with zod 4.4.3 | 2 optional model-id widenings, `generic` |
| [digitalchokro/askchokro#31](https://github.com/digitalchokro/askchokro/pull/31) | `047fc448` | `190714f3` | 4.104.0 → 7.4.0 | none (compiles unchanged) |
| [microsoft/prompty#527](https://github.com/microsoft/prompty/pull/527) (`runtime/typescript`) | `e878b6b7` | `1f40686f` | 4.104.0 → 7.10.0 | none (compiles unchanged) |

Choices made while reading, before scoring: comment-only lines are not sites (wardby's
`http-runtime.ts`, which records that openai 5+ traffic now goes through the global undici
dispatcher); zod 4 and `@openai/agents` edits in guardrails are another package's; the
guardrails `examples/` directory is outside its only tsconfig (`include: ["src/**/*"]`), so
the repository's compiler never sees it and the draft has no site there; ux-struggle-detector's
`max_tokens` change is kept as `generic` although the declaration is identical in 4.104.0 and
7.x (a request change the pack must never make); batch-ai's and guardrails' zod and
`@openai/agents` moves are recorded in `with` (openai 7's zod peer rejects batch-ai's 3.24.2;
`@openai/agents` 0.17 is the line that depends on openai 7).

Screened out: [lifestyle3nergy-web/TWGT-#73](https://github.com/lifestyle3nergy-web/TWGT-/pull/73)
(no openai import in source; the upgrade only added a contract test);
[respanai/respan](https://github.com/respanai/respan/commit/638218d238f02b43b461a7f7fa75c3872f6155ad)
(rewrote its instrumentation to support openai 4 to 7 side by side; not an upgrade);
[moxxy-ai/moxxy#634](https://github.com/moxxy-ai/moxxy/pull/634) and
[WasmAgent/wasmagent-js#441](https://github.com/WasmAgent/wasmagent-js/pull/441) (monorepo
dependency waves with ai 7, zod 4 and Node 22 moves; not drafted);
microsoft/teams.ts #850/#913/#931 and eovidiu/open-brain #174 (closed, not merged);
sx4im/skillcheck #107 and KeshiaServices/generative-ai-for-beginners #207 (open);
nexus-substrate/nexus-agents #7266, Edric-Li/code-argus #4, mayurrawte/teamsly #212
(6.x → 7, outside the range); headroom-ai and @codedprojects/api-mapper-openai (no
repository on npm); uptide-test/alanagoyal (the smoke test, by instruction).

## Measured: `pnpm uptide pack test openai --write`

| Rule / scoring group | Precision | Recall | TP | FP | FN |
| --- | ---: | ---: | ---: | ---: | ---: |
| tool-call-union | 100% | 33% | 1 | 0 | 2 |
| generic | 2% | 6% | 1 | 57 | 16 |
| Overall sites | 5% | 15% | 3 | 56 | 17 |
| **Breaking sites** | **42.86%** | **15%** | **3** | **4** | **17** |

Fixtures: 6 cases, 37 sites, pass. No other rule or note has an expected site in this truth;
none of them predicted one either (zero false positives from the pack's own detectors across
the seven repositories).

False positives:

- 4 breaking, guardrails `examples/basic/multiturn_with_prompt_injection_detection.ts:331,
  413, 428, 430`: real TS2345/TS2769 errors at 7.9.0 (`ResponseOutputItem` is no longer
  assignable to `ResponseInputItem`), reported by `check`'s generic compile of files that
  import openai. The repository's tsconfig excludes `examples/`, so its upgrade left them, and
  the truth (tsconfig-scoped) does not have them. They stay false positives.
- 52 non-breaking, prompty: `check` could not compile (its workspace packages import an
  unbuilt `@prompty/core`), so it lists type-diff sites as `unverified`.

False negatives, and why:

- charivo `openai-tool-format.ts:119`: found, as `generic`. The code narrows `raw` first, so
  the compiler says `Property 'name' does not exist on type '{}'`, which names nothing of
  openai; the rule does not claim such messages.
- charivo `:135`: the parameter type widened as a consequence of the fix at `:129`; no
  diagnostic, only the agent's edit reaches it.
- guardrails `client.ts` ×10: the subclass rework for `withOptions()` cloning has no compiler
  error; `client-subclass` names the file as a decision ("`src/client.ts` extends OpenAI"),
  which `pack test` does not score.
- wardby ×2, batch-ai ×2: optional cleanups that 7.x types allow; nothing breaks.
- ux-struggle-detector ×2: a request-parameter change; the pack never changes what the
  application sends.

## What the engine could not express (separate tasks)

1. **Companion planning for the target's own peers and dependents.** `check/companions.ts`
   moves packages that depend or peer on the lead, never the lead's own peers: batch-ai keeps
   zod 3.24.2 although openai 7 peers on `zod ^3.25 || ^4.0`, so `fix` would produce an install
   the real upgrade never had. `@openai/agents` 0.1.x (a regular dependency on openai 5) is
   also left where guardrails moved it with openai. Both fail `with` (`leftBehind`).
2. **Compile scope.** `check` compiles files that import the package even outside every
   tsconfig; `packs:truth` compiles tsconfigs only. Any repository with untype-checked
   examples turns real errors into false positives (guardrails).
3. **Decision evidence from sources.** `applies()` sees only the declared inventory, so the
   pack declares source globs (`src`, `app`, `lib`, …) to find helper imports and subclasses;
   files elsewhere are missed. A hook passing the usage files would be exact.
4. **`--no-llm` report labels.** A site of an assisted rule that was not rewritten is labelled
   with its symbol path in the PR body, not the rule (the agent's task does use the rule).

With 1 and 2 resolved and the same truth, the breaking predictions left in this run are the
three true positives; the gate would then need a rerun to say so.

## Smoke test (not ground truth)

`uptide fix openai --no-llm` on uptide-test/alanagoyal (openai 4.104.0 → 7.33.0), with the
pack forced active by an **uncommitted local edit** of `verification.json` (only verified packs
are active), restored afterwards. 5 compiler errors, all `ChatCompletionMessageToolCall#function`
(the 5.12.1 union, claimed by `tool-call-union`); no rewrite applies and no LLM key was
available, so all 5 stay manual; `next build` fails on them; tests pass. Decisions were scoped
by evidence: Node 24.x and TypeScript ^5 meet the floor, so only the general review line shows.
No branch was pushed and nothing was published.
