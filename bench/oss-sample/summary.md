# OSS sample run: summary (UPT-77)

30 public TypeScript repositories (`sample.json`: 10 npm, 10 pnpm, 10 yarn, pinned commits), one
upgrade target each, `uptide check <pkg>` then `uptide fix --only <pkg> --no-llm`, scripts off, no
LLM, no services, nothing pushed. Run with the CLI built from `main` at aca2962 (the pin re-run below: aee6b82), Node 22.20,
three repositories at a time.

**Result.** 28 repositories ran; 2 (`gitalk/gitalk`, `nestjs/typeorm`) have no outdated dependency
the code imports. `check` is sound on 27 of 28. `fix --no-llm` verified 1 of 28.

Targets: every repo that ran uses a dependency with a verified pack, so none fell back. In 12 the
available upgrade is inside the pack's range (`pack, tier verified`), so `fix --no-llm` had
rules to run. In 16 the pack dependency is typescript (14) or vitest (3.x to 5.x) at a version the
pack does not cover (`pack, tier generic`), so a clean no-pack stop is the correct outcome and only
the way it stops matters. Only the 12 verified-range runs say anything about migrations.

| outcome of `fix --no-llm` | repos |
| --- | ---: |
| verified (exit 0) | 1 |
| not verified: new type errors remain after react 19 without an LLM (exit 1, expected) | 2 |
| documented peer-blocker stop (exit 2, before cloning, expected) | 6 |
| no-pack stop, correct outcome but reached after cloning and installing | 10 |
| refusal or failure that is a defect (below) | 9 |

Zero timeouts (limits 900 s `check`, 1800 s `fix`), zero setup failures after the harness fixes
(see Notes). Raw logs stay out of the repository.

## Findings with counts

- **Slow refusals (exit 2 after more than 10 s): 18 `fix` runs and 1 `check` run, 19 of the 28
  repositories' 56 steps.** Median 57 s, slowest 189 s. Breakdown: no-pack after clone 9,
  pnpm resolution guard 3, npm install conflict 2, `resolutions` pin 1, worker crash 1,
  misleading message 1, peer blocker 1 (21 s), `check` cache race 1.
- **Leftover temp entries: 1 of 28.** `UPTIDE_RUNS_DIR` held a `run-*` directory after `fix` exited
  only for `alovajs/alova` (the crash below). The other 27 cleaned up, including every refusal.
  The shared temp directory also held tool caches (Node, Jest, Nx) and `uptide-no-hooks`; those
  are not clones and are not counted.
- **Checkout integrity: 28 of 28 untouched** (same HEAD, files, hooks and config). In 3 repos
  `fix` added its export branch `uptide/<package>-<version>` to the checkout; that is the
  documented export, not a violation.

## Table

The classes in the table are the mechanical ones from `classify.mjs`; the reviewed grouping is under Root causes.

| repo | manager | target | check | fix |
| --- | --- | --- | --- | --- |
| AgoraIO-Extensions/react-native-agora (mono) | yarn-berry | react 18.3.1→19.3.1 (pack, tier verified) | success (exit 0, 22s) | false-refusal (exit 2, 63s) |
| alovajs/alova (mono) | pnpm | react 18.3.1→19.3.1 (pack, tier verified) | success (exit 1, 24s) | crash (exit 2, 90s) |
| arwes/arwes (mono) | npm | react 18.3.1→19.3.1 (pack, tier verified) | success (exit 1, 53s) | expected (exit 2, 3s) |
| Brandawg93/PeaNUT | pnpm | typescript 6.0.3→7.0.2 (pack, tier generic) | success (exit 0, 8s) | other (exit 2, 45s) |
| express-rate-limit/express-rate-limit | pnpm | typescript 5.9.3→7.0.2 (pack, tier generic) | success (exit 0, 2s) | other (exit 2, 27s) |
| folke/devmoji | yarn | typescript 4.3.5→7.0.2 (pack, tier generic) | success (exit 0, 2s) | other (exit 2, 13s) |
| gitalk/gitalk (mono) | pnpm | - | - | - |
| googlemaps/google-maps-services-js | yarn | typescript 5.8.3→7.0.2 (pack, tier generic) | success (exit 0, 7s) | expected (exit 2, 2s) |
| gremo/nest-winston | npm | typescript 4.9.5→7.0.2 (pack, tier generic) | success (exit 1, 4s) | expected (exit 2, 1s) |
| HelloGitHub-Team/geese | yarn | react 18.2.0→19.3.1 (pack, tier verified) | success (exit 1, 24s) | other (exit 1, 73s) |
| line/abc-user-feedback (mono) | pnpm | typescript 5.9.3→7.0.2 (pack, tier generic) | success (exit 0, 31s) | other (exit 2, 189s) |
| makenotion/notion-sdk-js | npm | typescript 5.9.2→7.0.2 (pack, tier generic) | success (exit 0, 3s) | expected (exit 2, 1s) |
| nestjs/typeorm | npm | - | - | - |
| nestjsx/nestjs-config | yarn | typescript 4.5.2→7.0.2 (pack, tier generic) | success (exit 0, 2s) | expected (exit 2, 2s) |
| nestjsx/nestjs-typeorm-paginate | yarn | typescript 4.9.5→7.0.2 (pack, tier generic) | success (exit 0, 1s) | other (exit 2, 7s) |
| octokit/webhooks.js | npm | vitest 4.0.5→5.0.5 (pack, tier verified) | success (exit 0, 4s) | false-refusal (exit 2, 14s) |
| oh-my-mermaid/oh-my-mermaid | npm | vitest 4.1.0→5.0.5 (pack, tier verified) | success (exit 0, 5s) | success (exit 0, 14s) |
| oil-oil/wolfcha (mono) | pnpm | stripe 20.2.0→23.0.0 (pack, tier verified) | success (exit 1, 9s) | false-refusal (exit 2, 85s) |
| onflow/fcl-js (mono) | npm | react 18.2.0→19.3.1 (pack, tier verified) | success (exit 0, 24s) | false-refusal (exit 2, 2s) |
| oomol-lab/open-connector (mono) | npm | vitest 5.0.4→5.0.5 (pack, tier generic) | success (exit 0, 45s) | other (exit 2, 57s) |
| open-telemetry/opentelemetry-js (mono) | npm | typescript 5.2.2→7.0.2 (pack, tier generic) | success (exit 0, 17s) | expected (exit 2, 21s) |
| orchetron/storm | npm | vitest 4.1.2→5.0.5 (pack, tier verified) | success (exit 0, 9s) | false-refusal (exit 2, 17s) |
| prettier/pretty-quick | yarn-berry | typescript 5.8.3→7.0.2 (pack, tier generic) | success (exit 0, 29s) | false-refusal (exit 2, 45s) |
| react-native-community/cli (mono) | yarn | typescript 5.2.2→7.0.2 (pack, tier generic) | success (exit 0, 4s) | other (exit 2, 23s) |
| reactchartjs/react-chartjs-2 (mono) | pnpm | vitest 4.0.4→5.0.5 (pack, tier verified) | success (exit 0, 17s) | false-refusal (exit 2, 56s) |
| saas-js/saas-ui (mono) | pnpm | vitest 3.2.4→5.0.5 (pack, tier generic) | success (exit 0, 98s) | other (exit 2, 182s) |
| stephenh/ts-proto | yarn-berry | typescript 5.9.3→7.0.2 (pack, tier generic) | success (exit 1, 5s) | other (exit 2, 19s) |
| t3-oss/create-t3-turbo (mono) | pnpm | typescript 5.9.3→7.0.2 (pack, tier generic) | success (exit 0, 9s) | other (exit 2, 73s) |
| TanStack/virtual (mono) | pnpm | vitest 4.1.4→5.0.5 (pack, tier verified) | false-refusal (exit 2, 30s) | false-refusal (exit 2, 161s) |
| VoidenHQ/voiden (mono) | yarn-berry | react 18.3.1→19.3.1 (pack, tier verified) | success (exit 1, 61s) | other (exit 1, 303s) |


`target` is `kind, tier`: `pack` = the dependency has a verified pack; `tier verified` = the available
upgrade is inside the pack's range. `exit` in `check` 1 means breaking changes were found, which is a
success. Names are public repositories at the commits in `sample.json`.

## Root causes

Each line is ready for Linear. "Repos" counts distinct repositories out of the 28 that ran.

1. **Root-pin and peer-blocker refusals reached after clone/install instead of in preflight.**
   1 repo for root pins, 1 more for yarn peer blockers; slowest times 63 s and 45 s.
   - `AgoraIO-Extensions/react-native-agora` (yarn): `resolutions["@types/react"]` pinned to 18.3.1;
     `fix` refused after 63 s (the install had already run). Fixed on `main` by UPT-8 (#179, #180); see
     the pin re-run below.
   - `prettier/pretty-quick` (yarn Berry, typescript 5.8.3 to 7.0.2): `ts-jest` and `tsdown` peer
     blockers were printed, then the run stopped after 45 s with `typescript has no upgrade to 7.0.2`.
     The npm preflight (`peer blockers to resolve first`, 1 to 3 s in 5 repos, 21 s in the
     29-package `opentelemetry-js`) did not run for yarn Berry, and the final message names the wrong cause.
2. **`octokit/webhooks.js` peer conflict that preflight missed.** 2 repos (`octokit/webhooks.js`,
   `orchetron/storm`, both npm, vitest 4.x to 5.0.5), 14 s and 17 s. `fix` did not stop in preflight;
   `npm install --package-lock-only` then failed with `ERESOLVE`: vitest 5.0.5 peers on
   `vite ^6.4 || ^7 || ^8`, and vite 8.3.4's optional peer on `esbuild ^0.27 || ^0.28` conflicts with the
   repo's esbuild. The conflict sits one hop below a direct dependent, which the preflight does not walk.
3. **No-pack stop comes after clone and install.** 10 repos, 7 to 189 s (9 over 10 s); targets typescript
   to 7.0.2 (8) and vitest to 5.0.5 (2). `docs/commands/fix.md` says `--no-llm` without a pack "exits
   before creating a clone"; it does that when a peer blocker is found first (1 to 3 s) but not otherwise.
   Slowest: `line/abc-user-feedback` 189 s, `saas-js/saas-ui` 182 s, `t3-oss/create-t3-turbo` 73 s.
4. **pnpm install guard refuses on resolutions the upgrade did not cause.** 3 repos, 56 to 161 s
   (`oil-oil/wolfcha` stripe, `reactchartjs/react-chartjs-2` and `TanStack/virtual` vitest). Error:
   `Install changed resolutions outside <pkg>'s dependency subtree`, listing platform-specific optional
   packages (`@img/sharp-libvips-*`) and `picomatch` as "same version, different resolution". Looks like
   lockfile churn from re-resolving, not from the upgrade; a false refusal on the three repos where a
   verified pack applies.
5. **Out-of-memory crash in the analysis worker, and the run directory is left behind.** 1 repo
   (`alovajs/alova`, pnpm, 19 packages, react 18 to 19): `Worker terminated due to reaching memory limit:
   JS heap out of memory` after 90 s, exit 2, and a `run-*` directory stays in the runs root. The only
   leftover temp entry in the sample.
6. **`spawnSync git ENOBUFS` in `fix`.** 1 repo (`onflow/fcl-js`, npm, 29 packages): `fix` stops at 1.1 s
   with a Node `spawnSync` buffer error as its message, exit 2. A git command's output exceeds the default
   buffer; internal error reported as a refusal.
7. **`check` exits 2 with no message after a registry-cache race.** 1 repo (`TanStack/virtual`, pnpm
   monorepo, 68 packages): `tinyglobby` skipped with `could not resolve latest: ENOENT ... rename
   '.../resolve-latest.json.<pid>.tmp'`, so `failed: 1` and exit 2, while stderr shows only `done in 30s`.
   The temp name carries only the pid, so two workspaces resolving the same package in one process write
   and rename the same file.

Not defects, listed so they are not filed: the peer-blocker preflight stop (6 repos, expected exit 2);
`fix` exit 1 after the react 19 bump leaves new type errors that need an LLM or manual sites
(`HelloGitHub-Team/geese`, `VoidenHQ/voiden`, the latter in 303 s); `fix` adding its export branch
`uptide/<package>-<version>` to the checkout (3 repos, documented).

## Root-pin re-run on latest main (UPT-8)

`react-native-agora` is the only repo whose `fix` refused on `resolutions` or `overrides`. Re-run on
`main` at aee6b82 (includes #179 and #180), target react 18.3.1 to 19.3.1:

| `--update-pins` | upgrade? | time to refusal or first edit | outcome |
| --- | --- | --- | --- |
| off | no, nothing changed | refused after 1.0 s (was 63 s before UPT-8) | exit 2: `Root pins conflict with this upgrade: "resolutions" > "@types/react" pins @types/react to 18.3.1; it will be updated to 19.3.0. Rerun with --update-pins` |
| on | yes: branch `uptide/react-19.3.1`, react 19.3.1 and `@types/react` 19.3.0, 4 files changed | first edit about 25 s in (sum of the analysis and baseline phases before `install · react 19.3.1`; the install itself took 55 s); 134 s in total | exit 1: not verified, 62 new type errors and failing tests in `examples/legacy`, which `--no-llm` cannot fix |

Phase times come from a second `--verbose` run of the same command and are a sum of phase timings,
some of which overlap.

## Notes

- A first full pass was discarded: an outage failed 11 clones, two installs failed on npm's engine
  check (Node 20 required, 22 installed; the runner now sets `engine-strict=false` for installs), and
  the temp-entry check counted shared caches. Harness changes after that pass: Uptide's runs directory is
  pointed at a private folder and counted on its own, and the classifier reads JSON error messages, treats
  `JS heap out of memory` as a crash and a peer blocker as the documented stop.
- Target choice changed once during the work: the first list preferred any outdated dependency; it now
  prefers the packs Uptide ships, so `fix --no-llm` has rules where the version is in range.
- `fix` adds an `uptide/*` branch to the source checkout; the harness records that as a change but it is
  the documented export.
- One run, one commit per repo, three at a time: durations carry noise, and the cache race (7) may depend
  on that concurrency.
