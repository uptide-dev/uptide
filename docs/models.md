---
title: Models
description: Which Anthropic model assisted fixes use, how to choose one, and what the budget flag limits.
---

# Models

For someone running `uptide fix` who wants to choose the model and the budget. Measured
results are in the [provider evaluation](provider-evaluation.md); rates in
[model pricing](model-pricing.md).

## Choosing a model

`fix` runs assisted fixes only with the Claude Agent SDK, on Anthropic models, with your own
`ANTHROPIC_API_KEY` from the environment. Never put keys in repository config or command
arguments. Without the key or the SDK, `fix` stops before any clone
([`fix`](commands/fix.md#the-claude-agent-sdk)).

```sh
npx uptide fix zod --model claude-sonnet-5-5
UPTIDE_MODEL=claude-sonnet-5-5 uptide fix stripe
npx uptide fix zod --max-cost 1
```

For the model, precedence is `--model` → `UPTIDE_MODEL` → nearest `uptide.config.json` up to
the Git root. The model prints before the fix starts, and spend prints at the end.

The optional config accepts **only** `provider` and `model` strings:

```json
{ "provider": "anthropic", "model": "claude-sonnet-5-5" }
```

Unknown fields, nested settings and key-like values are rejected, including when flags would
override them. Keys are read only from the environment. Another provider (`openai`,
`gemini`), from the config, `UPTIDE_PROVIDER` or a lone `OPENAI_API_KEY` / `GEMINI_API_KEY`,
makes `fix` stop with exit 2: the SDK runs on Anthropic models only.

## Defaults

Checked against official documentation on 2026-10-04. OpenAI and Gemini remain for Uptide's
own evaluations (`UPTIDE_INTERNAL=1`, with the patch executor); `fix` does not run them.

| Provider | Default | Reference |
| --- | --- | --- |
| Anthropic | `claude-sonnet-5-5` (`medium` effort) | [Sonnet 5.5](https://platform.claude.com/docs/en/models/sonnet-5-5/overview); selected after the storefront comparison |
| OpenAI | `gpt-6.1-sol` | [GPT-6.1 Sol](https://developers.openai.com/api/docs/models/gpt-6.1-sol), through the Responses API |
| Gemini | `gemini-3.8-flash` | [Gemini 3.8 Flash](https://ai.google.dev/gemini-api/docs/models/gemini-3.8-flash) |

Measured on the public storefront fixture (2026-10-04; USD from returned usage). Each cell
lists **zod / Stripe**; every run has a $1 ceiling:

| Provider | Model | Verified | Agent sites | Attempts | Cost USD |
| --- | --- | --- | --- | --- | --- |
| Anthropic | `claude-sonnet-5-5 (medium)` | pass / pass | 4 / 3 | 2 / 2 | $0.013244 / $0.021592 |
| OpenAI | `gpt-6.1-sol` | pass / pass | 4 / 3 | 2 / 3 | $0.006806 / $0.018677 |
| Gemini | `gemini-3.8-flash` | fail / fail | 0 / 0 | 12 / 9 | $0.000000 / $0.000000 |

Gemini's serial reruns failed after HTTP 503/429 and transport errors, despite a successful
protocol smoke. Its zero confirmed cost excludes $0.473901 / $0.368667 retained for
unreported usage; it is not a claim of zero possible billing. Full trials, reservations,
times, exact echoed IDs and the Sonnet 4.6/high/medium comparison are in the
[provider evaluation](provider-evaluation.md). These single fixture trials are not a general
model ranking.

The [executor evaluation](agent-sdk-evaluation.md) compares the SDK with the earlier patch
executor on three public repositories.

## `--max-cost`

`--max-cost` defaults to **$1 per package**, including zod and stripe. The default is never
raised for a large repository: spend goes up only when you raise the limit.

Before the first agent call, `fix` estimates what the sites left to the agent will cost:
20k input and 2k output tokens per site at the selected model's listed rates, which is $0.06
a site on the default `claude-sonnet-5-5` ($2/$10 per million). These are assumptions, not
yet calibrated against stored runs. `report.json` keeps the estimate (`llm.estimate`) next to
the actual spend (`llm.costUsd`) so the two can be compared. The run prints the estimate and
the limit. When the estimate is above the limit, `fix` stops before any agent call and exits
2, the same as other preflight stops:

```text
estimated $3.00 for 50 sites; limit $1.00. Run again with --max-cost 3.00.
```

When the agent stops at the limit mid-run, the summary and the pull request name the
estimate, the sites left and the limit that continues.

Action and App runs never stop on the estimate: nobody is there to rerun them. They work
within `maxCost` from `uptide.yml`, and when sites are left, the summary and the pull request
say so: `… 12 sites not completed. Raise maxCost in uptide.yml to 3.00 to finish.`

The SDK executor gives the package's session the limit and enforces it after each turn, so
it can overshoot by one turn.

The summary's `Phases` row and the PR's run details give wall time per phase (analyze,
baseline, install, rules, agent, verify, feedback) and the agent's spend in each.

`llm.costUsd` is computed from Uptide's price table per model and token class; the SDK's
own figure is `llm.sdkReportedCostUsd`, and `--max-cost` counts the higher of the two.
With the SDK, an unknown model's cost is the SDK's figure, marked unverified; with the
patch executor, unknown models use Anthropic's highest listed rates with a warning. See
[model pricing](model-pricing.md) for rates, token estimation and the scope of accounting.

## Privacy

SDK sessions send the finding, enclosing code and compiler error, and can also read and send
files throughout the temporary clone and the output of type-checks, lint and tests, to
Anthropic. Anthropic's data policy applies. Anonymous telemetry, when enabled, adds only the
provider and a public model ID; private/custom model IDs become `custom`. The full model:
[privacy](privacy.md).
