# Agent SDK default evaluation

UPT-23 repeats the public-repository experiment from
[PR #89](https://github.com/uptide-dev/uptide/pull/89). The target is a PATH/zod run under
eight minutes while retaining the SDK's improvement in fixed sites. A run that completes
is not necessarily verified: the final compiler and test verdict still controls publishing.

## Method

Three trials per repository and executor, run sequentially on the same machine. The SDK
trials omit `--agent`, exercising the new Anthropic default; patch trials add `--agent patch`.
All use `--provider anthropic --model claude-sonnet-5-5 --max-cost 1`, medium effort,
`--json --keep-temp --verbose`, and the same built CLI. Wall time includes isolation,
analysis, baseline checks, installation, assistance and final verification. Reported cost
comes from model usage, not an invoice. The SDK can exceed its budget by one turn.

The measured runtime sources are in `cf5682b`, built before that commit from base
`405f429`; the binary reports 0.7.5 and a dirty development tree. The subsequent merge
of `main` brings the 0.8.0 release and `uptide.yml` support, with explicit `patch` settings
preserved. None of these fixture roots or their ancestors has an `uptide.yml`. The measured
executor, pack and verification code is unchanged by that merge.

Machine: macOS, Mac15,6, 11 logical CPUs, 18 GiB RAM; Node 22.20.0, pnpm 10.17.1;
Agent SDK 0.3.296. Sources and installed dependencies were prepared before timing;
analysis, registry and provider prompt caches may be warm from earlier trials. Repository
installs disable lifecycle scripts.
Tests requiring external services are excluded by Uptide's normal service policy. The SDK
uses scoped session checks and a full selected suite at baseline and final verification;
the patch executor retains its existing test selection and retry behavior. Both use the
same final diagnostic comparison, but test scope is not identical.

| Repository | Source commit | Fix arguments |
| --- | --- | --- |
| [boxyhq/saas-starter-kit](https://github.com/boxyhq/saas-starter-kit) | `abc9b686823cbfb4973c79bc36fea37a3244be6c` | `stripe --target 23.0.0` |
| [alanagoyal/alanagoyal](https://github.com/alanagoyal/alanagoyal) | `22aa5f12047d5ec0188eed11da5cdc00ddb7d99a` | `react @radix-ui/react-tabs @radix-ui/react-tooltip react-resizable-panels --target 19.3.0 --allow-peer @emoji-mart/react` |
| [howardyang2009/PATH](https://github.com/howardyang2009/PATH) | `bb171417d911f373c8df28ab7a1e0698b62e0906` | `zod --target 4.6.5` |

React resolves `react-dom`, `@types/react` and `@types/react-dom` to 19.3.0,
`@radix-ui/react-tabs` and `@radix-ui/react-tooltip` to 1.1.0, and
`react-resizable-panels` to 2.1.5. Final lockfile hashes are identical across executors and
trials for each repository, so the controls use the same installed dependency graph.

## Results

Times, costs and site counts are medians, with ranges when they vary. “USD / agent fix”
is total spend divided by total agent-fixed sites across the three trials, excluding
mechanical fixes. Verification is the number of runs passing the final gate.

| Repository / upgrade | Executor | Time, median (range) | USD, median (range) | USD / agent fix | Fixed: mechanical + agent; manual | Types before → after | Verified |
| --- | --- | --- | --- | --- | --- | --- | --- |
| boxyhq / Stripe | patch | 2m58s (2m41s–3m18s) | $0.031 ($0.031–$0.072) | $0.011 | 2 + 4; 1 | 4 → 0 | 3/3 |
| boxyhq / Stripe | sdk | 2m29s (2m27s–2m58s) | $0.188 ($0.186–$0.191) | $0.044 | 2 + 4 (4–5); 1 (0–1) | 4 → 0 | 3/3 |
| alanagoyal / React | patch | 4m56s (4m06s–5m00s) | $0.103 ($0.100–$0.105) | $0.010 | 1 + 10; 2 | 13 → 2 | 0/3 |
| alanagoyal / React | sdk | 1m47s (1m45s–1m48s) | $0.077 ($0.076–$0.079) | $0.006 | 1 + 12; 0 | 13 → 0 | 3/3 |
| PATH / zod | patch | 7m36s (7m09s–7m37s) | $0.122 ($0.119–$0.144) | $0.035 | 17 + 4 (3–4); 2 (2–3) | 27 → 6 (6–7) | 0/3 |
| PATH / zod | sdk | 6m59s (6m43s–8m30s) | $0.221 ($0.217–$0.239) | $0.038 | 17 + 6; 0 | 27 → 2 | 0/3 |

- PATH meets the eight-minute target on median: two SDK runs are below eight minutes and
  one takes 8m30s. All three retain 23 planned fixes (17 mechanical + 6 agent) and reduce
  27 compiler errors to two. Those are a baseline TS5083 configuration error and a new
  TS2554 in `packages/engine/step-plugins/prompt/index.ts`, outside the planned editable
  sites. The final designer suite also fails. No PATH result is verified or publishable.
- Stripe verifies 3/3 for both executors after the shared knowledge/helper change. SDK is
  faster on median, but patch is substantially cheaper. The old one-third-cost-per-fixed-site
  claim does not hold in this rerun.
- React's SDK runs fix all 12 agent sites and verify 3/3. Patch fixes 10 sites in each trial
  but leaves two `RefObject` type errors in `notes-app.tsx`, so it verifies 0/3.

Seven PATH findings formerly attributed to assistance are now recognized as mechanically
resolved, in both executors. Agent-only totals are therefore not directly comparable with
PR #89. The controlled comparison above uses the same candidate for both executors;
the earlier experiment is historical context, not a timing control on this machine.

### Individual trials

| Trial | Seconds | USD | Mechanical | Agent | Manual | Remaining type errors | Verified |
| --- | --- | --- | --- | --- | --- | --- | --- |
| stripe-patch-1 | 198.09 | $0.0717 | 2 | 4 | 1 | 0 | yes |
| stripe-patch-2 | 161.12 | $0.0313 | 2 | 4 | 1 | 0 | yes |
| stripe-patch-3 | 177.93 | $0.0307 | 2 | 4 | 1 | 0 | yes |
| stripe-sdk-1 | 177.71 | $0.1883 | 2 | 5 | 0 | 0 | yes |
| stripe-sdk-2 | 148.88 | $0.1865 | 2 | 4 | 1 | 0 | yes |
| stripe-sdk-3 | 146.55 | $0.1910 | 2 | 4 | 1 | 0 | yes |
| react-patch-1 | 299.95 | $0.0997 | 1 | 10 | 2 | 2 | no |
| react-patch-2 | 295.93 | $0.1026 | 1 | 10 | 2 | 2 | no |
| react-patch-3 | 246.16 | $0.1051 | 1 | 10 | 2 | 2 | no |
| react-sdk-1 | 107.69 | $0.0760 | 1 | 12 | 0 | 0 | yes |
| react-sdk-2 | 106.50 | $0.0787 | 1 | 12 | 0 | 0 | yes |
| react-sdk-3 | 105.08 | $0.0766 | 1 | 12 | 0 | 0 | yes |
| path-patch-1 | 429.05 | $0.1190 | 17 | 4 | 2 | 6 | no |
| path-patch-2 | 456.13 | $0.1436 | 17 | 3 | 3 | 7 | no |
| path-patch-3 | 456.78 | $0.1221 | 17 | 4 | 2 | 6 | no |
| path-sdk-1 | 419.30 | $0.2210 | 17 | 6 | 0 | 2 | no |
| path-sdk-2 | 510.01 | $0.2387 | 17 | 6 | 0 | 2 | no |
| path-sdk-3 | 403.33 | $0.2170 | 17 | 6 | 0 | 2 | no |

## Implementation checks

[CI on the integrated implementation](https://github.com/uptide-dev/uptide/actions/runs/38334848211)
passed lint, build, typecheck, the full tests and clean-container npm/pnpm/Yarn smoke checks
on Node 20 and 22. Node 20 recorded 1,724 passing tests and 34 skipped; Node 22 recorded
1,726 passing and 32 skipped, plus 18 passing package-manager/bot-loop network tests.
[Every migration pack passed its evaluation](https://github.com/uptide-dev/uptide/actions/runs/38334848243).
A separate clean npm installation of the packed CLI resolved the SDK automatically.
The generated Stripe handler checks below supplement the repository suites; no live
Stripe events or service-dependent application integration tests were run for this benchmark.

## Stripe webhook checks

The generated helpers and both subscription webhook handlers from all three SDK and all
three patch trials were also exercised with synthetic legacy subscription-level and modern item-level periods.
All produced the expected dates. The checks stubbed database and Stripe calls and confirmed
that valid payloads did not require a refetch; they did not replay live webhook events.
Helper checks also covered mixed shapes, missing periods and non-finite timestamps.

Two SDK trials and all three patch trials left `sync-stripe.js` on its old API version
for manual review. Those sites remain manual in the results even though compilation and final tests passed.
Changing an API pin can change runtime responses and needs a separate compatibility decision.

## Development trials

These informed implementation changes and are excluded from the final comparison:

- Four SDK sessions on PATH: 815s, $0.441, 12 agent sites fixed, 27 → 2 type errors;
  final verification failed.
- Three sessions on PATH with medium effort and no scoped-test retries: 715s, $0.343,
  11 agent sites fixed, 27 → 2 type errors; final verification failed.
- One session on PATH: terminated at 502s during final type-checking with a worker heap
  error. No complete report or final verdict was produced. The retained incremental
  compiler cache was then released before fresh final checks to avoid holding both.
- After releasing the cache, one session completed in 579s at $0.316, with 7 agent
  sites fixed and 27 → 2 type errors; final verification failed. Final tests took 141s.
  The full-suite planner was then made explicit and recursive pnpm checks deduplicated,
  with `--no-bail` so later workspaces still run and failures retain a nonzero exit.

The next three PATH trials took 492s, 405s and 488s (median 488s). One session
was rejected because it left an undeclared scratch file, losing all its agent edits.
That prompted cleanup of undeclared additions before revalidating the remaining edits,
plus clearer ordering of edits, types, lint and tests. The reverted tree also showed
seven compiler sites that mechanical rules had already resolved but the plan still called
manual. Both executors now skip those confirmed sites in error-free files and count them
as mechanical fixes. Compare total fixed sites and remaining diagnostics when comparing
with the old table; agent-only attribution changed. These trials precede the final build.

An earlier exploratory run was interrupted before completion. Its cost is unavailable;
none of these exploratory runs is counted as a successful benchmark trial.

## Interrupted measurements

The laptop slept during two runs of an earlier candidate build. They were retained separately and
repeated rather than subtracting guessed sleep durations from wall time. One completed at
3886s ($0.331, 8 agent sites, 27 → 2 type errors); the next was stopped at 13365s before
assistance began. Neither counts toward the three valid timing trials. macOS power logs
confirm clamshell sleep during these runs. Subsequent trials prevent idle sleep for the
lifetime of the benchmark process; closing the lid can still interrupt them.
