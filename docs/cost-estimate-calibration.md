# SDK cost estimate calibration (UPT-94)

The SDK handles a package's pending sites in one session. Pricing each site as
20,000 uncached input tokens plus 2,000 output tokens ($0.06 on Sonnet 5.5)
charged repeatedly for shared rule knowledge and verification. The patch executor
still uses that allowance: these SDK observations do not calibrate its separate calls.

## Recorded pairs

These are original `report.json` estimates and spend, checked against the pilot's
`meta.json`, not fresh paid runs. All use `claude-sonnet-5-5`, SDK executor.

| Run | Agent sites | Mechanical sites | Feedback rounds | Old estimate | Actual USD | New estimate | New / actual |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| alanagoyal React 18 → 19.3.1 | 18 | 1 | 1 | 1.08 | 0.1336105 | 0.16 | 1.20 |
| calmcp, round 4, `3ecb8897` | 5 | 1 | 0 | 0.30 | 0.0842459 | 0.09 | 1.07 |
| dms-saas, round 4, `08cc4e68` | 10 | 2 | 0 | 0.60 | 0.2740438 | 0.28 | 1.02 |
| enki, round 4, `1ff708af` | 9 | 3 | 1 | 0.54 | 0.1431526 | 0.19 | 1.33 |

Sources: [pilot #169 comments](https://github.com/uptide-dev/uptide/pull/169),
[calmcp report](https://github.com/uptide-bench/consetto--calmcp/pull/10),
[dms-saas report](https://github.com/uptide-bench/AntelopeJS--dms-saas/pull/13),
[enki report](https://github.com/uptide-bench/entur--enki/pull/9).
The alanagoyal report is the local stored `uptide__react-19.3.1/report.json`
referenced by the task. Its recorded limit was $3; the pilot limits were $1.
Round 5 explicitly reuses round 4's Uptide runs; its Claude/Fable runs are not
additional Uptide samples. The rounded public costs match the precise local metadata.

The checked-in fixture `packages/core/src/llm/__fixtures__/cost-runs.json` retains
only the relevant report fields, with agent-fixed outcomes restored to manual
(the pre-agent state). Initial SDK task site counts match `llm.estimate.sites`;
no feedback-created sites have been added. No repository source or local absolute
paths are stored. Round counts are evidence only, never estimator inputs.

The current main checkout's `bench/` contains the OSS sample harness, not pilot
results. The pilot branch's harness writes reports/meta outside the checkout via
`BENCH_OUT`; the local round-4 output was available for this calibration. Existing
`fixtures/repos/*/expected-report.json` are analysis fixtures, not paid fix runs.
The older `docs/agent-sdk-evaluation.md` records executor comparisons before this
preflight estimator existed; those lack recorded estimate/actual pairs and are
not represented as validation of this fit. Earlier #169 rounds also used different
executor/verification behavior (including three feedback rounds on dms-saas).

## Formula and findings

For pending manual sites only, use the selected model's pricing table and round
up once to a cent:

- Session minimum: 20k input + 5k output token equivalents ($0.09 on Sonnet).
- Per distinct migration rule: 12.5k input + 2k output equivalents ($0.045).
- Per pending site: 250 input + 50 output equivalents ($0.001).
- Estimate = max(session minimum, rule allowance + site allowance); zero if no sites remain.

These are effective uncached token equivalents, not forecasts of raw token totals
or hard reservations. Actual SDK input includes cheap cached reads: calmcp reports
105,859 input / 3,396 output tokens for $0.0842, while dms-saas reports
668,074 / 8,258 for $0.2740. Treating those input totals as uncached would be wrong.
The floor and allowances include typical feedback (0–1 rounds in these samples),
not three complete additional sessions per site. The old implementation had no
explicit round multiplier: its uncalibrated per-site allowance implicitly covered retries.

Distinct rule counts are 3, 1, 6, and 4 respectively. A declaration-only
`anchorOnly` finding contributes its site allowance but not another independent
rule allowance: it supplies a possible repair location for downstream failures.
Enki has one such anchor (`JourneyPatternsMapState`). Anchor-only runs still get
the full session minimum. Missing rule names fall back to the change path.
Repeated sites of one rule retain a linear context allowance, so large runs are
not capped at the session minimum.

Mechanical sites were already excluded after rule application and compiler
rechecking. There was no mechanical-site counting bug in these four runs; the new
estimator preserves that boundary. This is a small, in-sample calibration, not a
claim of 1.5x accuracy on unseen projects, long feedback loops, or other providers.
Revisit the coefficients with more runs; do not add repository-specific rates.

## Spending limits

The estimate remains a pre-run prediction. CLI runs stop before the first call
when it exceeds the configured limit; equality is allowed. Action/App runs keep
working within the configured limit. Neither path increases that limit.

UPT-14's worst-case patch reservations, SDK budget, nanodollar accounting, and
unreported-usage charges are unchanged. Feedback receives only the remaining
budget and still has a three-round ceiling. UPT-111's isolated test reruns and
flake handling are unchanged; tests rerun by verification are not assumed to be
new paid agent sessions. A low estimate never authorizes extra spend. Stop
messages and reports use the same recorded estimate and configured limit.
