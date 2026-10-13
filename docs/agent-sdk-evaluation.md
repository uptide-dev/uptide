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

Machine: macOS, Mac15,6, 11 logical CPUs, 18 GiB RAM; Node 22.20.0, pnpm 10.17.1;
Agent SDK 0.3.296. Sources and installed dependencies were prepared before timing;
analysis and registry caches may be warm. Repository installs disable lifecycle scripts.
Tests requiring external services are excluded by Uptide's normal service policy. The SDK
uses scoped session checks and a full selected suite at baseline and final verification;
the patch executor retains its existing test selection and retry behavior. Both use the
same final diagnostic comparison, but test scope is not identical.

| Repository | Source commit | Fix arguments |
| --- | --- | --- |
| [boxyhq/saas-starter-kit](https://github.com/boxyhq/saas-starter-kit) | `abc9b686823cbfb4973c79bc36fea37a3244be6c` | `stripe --target 23.0.0` |
| [alanagoyal/alanagoyal](https://github.com/alanagoyal/alanagoyal) | `22aa5f12047d5ec0188eed11da5cdc00ddb7d99a` | `react @radix-ui/react-tabs @radix-ui/react-tooltip react-resizable-panels --target 19.3.0 --allow-peer @emoji-mart/react` |
| [howardyang2009/PATH](https://github.com/howardyang2009/PATH) | `bb171417d911f373c8df28ab7a1e0698b62e0906` | `zod --target 4.6.5` |

## Stripe webhook checks

The generated helpers and both subscription webhook handlers from all three SDK trials
were also exercised with synthetic legacy subscription-level and modern item-level periods.
All produced the expected dates. The checks stubbed database and Stripe calls and confirmed
that valid payloads did not require a refetch; they did not replay live webhook events.
Helper checks also covered mixed shapes, missing periods and non-finite timestamps.

Two SDK trials deliberately left `sync-stripe.js` on its old API version for manual review.
Those sites remain manual in the results even though compilation and final tests passed.
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
