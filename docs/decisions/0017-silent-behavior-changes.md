# 0017: Silent behavior changes: a cited source line and a usage site, or no finding

Status: proposed (2026-10-18). Research and design only (UPT-112): nothing here changes the
engine yet. The work is split into UPT-113 and UPT-114 at the end.

## Context

UpgradeBench rounds 1 to 5 (#169) have one result that no arm improved: Uptide, Claude Code on
Sonnet and Claude Code on Fable all ship the upgrade green, and all miss the same changes the
human made for runtime behavior. The bench calls them escaped-regression candidates: calmcp's
`.strict()` on its MCP tool schemas (zod 3.25.76 → 4.6.5), and dms-saas's `billing_mode`,
`managed_payments` and provisioning changes (stripe 18.5.0 → 22.6.2, API version
`2025-08-27.basil` → `2026-08-26.dahlia`). Types, lint, tests, build and fork CI pass without
them.

This ADR first establishes, from primary sources, which of those changes the upgrade actually
requires. Then it designs how Uptide finds that class of change. Every quote below is from the
published package, the vendor's changelog or docs, or the human's commit in the bench fork:
calmcp `bdaef39` (parent `741de4e`) and dms-saas `f992f33` (parent `6390f43`).

### Case 1: calmcp, zod 3.25.76 → 4.6.5, `.strict()` on the tool input schemas

calmcp passes raw zod shapes to `@modelcontextprotocol/sdk` 1.30.1 (`registerTool(name,
{ inputSchema: calmListShape })`, identical in both lockfiles). The SDK converts them to the JSON
Schema it advertises in `tools/list`, and the converter depends on the zod major
(`dist/esm/server/zod-json-schema-compat.js`):

```js
if (isZ4Schema(schema)) {
    // v4 branch — use Mini's built-in toJSONSchema
    return z4mini.toJSONSchema(schema, { target: mapMiniTarget(opts?.target), io: opts?.pipeStrategy ?? 'input' });
}
// v3 branch — use vendored converter
return zodToJsonSchema(schema, { strictUnions: opts?.strictUnions ?? true, pipeStrategy: opts?.pipeStrategy ?? 'input' });
```

- **Zod 3 path.** `zod-to-json-schema` 3.25.2 defaults to `removeAdditionalStrategy:
  "passthrough"` (`Options.js`), and for a plain (`strip`) object
  `parsers/object.js` returns `refs.rejectedAdditionalProperties`, which is `false`. So every
  calmcp tool advertised `additionalProperties: false`.
- **Zod 4 path.** zod 4.6.5 `v4/core/json-schema-processors.js`, `objectProcessor`:
  `else if (!def.catchall) { // regular  if (ctx.io === "output") json.additionalProperties =
  false; }`. The SDK always asks for `io: 'input'`. zod's JSON Schema docs say so in prose:
  "When converting to JSON Schema in `"input"` mode, `additionalProperties` is not set." Only
  `z.strictObject()` (or `.strict()`, a catchall of `never`) "will _always_ set
  `additionalProperties: false`".
- **The zod 4 changelog doesn't mention it.** It covers `.strict()`/`.passthrough()` ("These
  methods are generally no longer necessary … they will not be removed"), the stricter
  `z.uuid()` and `._def` → `._zod.def`. It says nothing about what a JSON Schema converter emits,
  because zod 3 had no converter: the old behavior lived in a third package.

**The old code on the new version, at runtime:** the SDK's `validateToolInput` parses arguments
with the object schema and returns `parseResult.data`. A plain object strips unknown keys on both
majors, so the server never rejected `{ resource: "tasks", projectId: "p" }`, before or after. What
changed is the contract the model reads: `tools/list` drops `additionalProperties: false` from
all five tools. A model that invents `projectId` for `project_id` is no longer told up front
that it can't, and the server drops the key without a word. The human's comment in
`src/tools/index.ts` says exactly that.

**The human's change.** `strictInput(shape) = z.object(shape).strict()` on all five tools
restores `additionalProperties: false` in `input` mode. That part keeps the old behavior, and
the upgrade requires it. The change also goes one step further: `.strict()` makes the server
reject an unknown key with `InvalidParams` naming it, which neither version did. The new test
`names an invented parameter instead of dropping it` pins that. **That part is a product
choice** layered on the fix. A minimal fix would be the same `.strict()`. The difference is
only whether the new rejection is called out in the PR.

**Why every check passed.** Types are unchanged. Uptide's zod verification compares *parse*
outcomes on sampled inputs ("the checked schemas behave the same as before on 400 sampled
inputs", round 4's PR), and parse behavior really is unchanged. calmcp's own `tool-surface` CI
compared each tool's title, annotations, `properties` and `required`, but no other schema key.
The human extended it to every other key, `additionalProperties` included, in the same commit.

### Case 2: dms-saas, stripe 18.5.0 → 22.6.2, API `2025-08-27.basil` → `2026-08-26.dahlia`

The bench lists three candidates. Read against the sources, they are one required change, one
type cleanup and one refactor that carries the required change.

#### `billing_mode: { type: "classic" }`: required to keep behavior

Stripe API changelog, `2025-09-30.clover`, "Makes flexible billing mode the default for new
subscriptions" (breaking): "Subscriptions you create through the API now default to flexible
billing mode. To use `classic`, set the `billing_mode.type` parameter to `classic`." It lists
"Create a subscription" and "Subscriptions created through the Checkout Session API" among the
affected integrations, and the billing-mode guide adds: "You can't migrate a subscription from
flexible billing mode to classic billing mode."

**There is no compile-time trace.** `SubscriptionCreateParams.billing_mode?` has the same JSDoc in
18.5.0 and 22.6.2 ("Controls how prorations and invoices for subscriptions are calculated and
orchestrated."). stripe-node's 19.0.0 CHANGELOG, the release that pinned clover, says only "Add
support for `flexible` on … `SubscriptionCreateParams.billing_mode`". The default flip lives
only in the API changelog.

**The old code on the new version, at runtime:** both creation paths omit `billing_mode`:
`subscriptions.create` in `workspaces/provisioning.ts:355`, and Checkout's `subscription_data`
in `stripe/workspace-checkout.ts:211`. So every new subscription is `flexible`, while every existing
one stays `classic`. The comparison page (docs.stripe.com/billing/subscriptions/billing-mode/compare)
names two differences that hit code this repo has:

- **Free-to-paid upgrade.** A registration lands on the default free plan
  (`provisioning.ts:225`). The upgrade (`routes/tenant/tenant-plan-ops.ts:196`) swaps the price
  with `proration_behavior: "create_prorations"`. Classic: "The `billing_cycle_anchor` is
  automatically reset … changing from zero-amount prices to non-zero prices". Flexible: "Stripe
  creates pending invoice items but doesn't immediately generate an invoice or attempt a
  charge." So the first paid charge slips to the next cycle.
- **Customer Portal cancellations.** The repo opens the portal (`routes/tenant/billing-portal.ts:160`).
  Classic sets "`cancel_at_period_end` … to `true`". Flexible: "`cancel_at_period_end` is set to
  `false` and `cancel_at` is set to the maximum `current_period_end`". `holdsPendingState`
  (`plan-changes/deferred.ts:235`) and `resetSubscriptionPendingState`
  (`stripe/plan-schedule.ts:127`) read only `cancel_at_period_end`, so a portal-scheduled
  cancellation becomes invisible to both. That holds if the account's portal configuration
  allows cancellation, which lives in the Dashboard, not the repo.

**The human's change.** `SUBSCRIPTION_BILLING_MODE = { type: "classic" }` on both creation paths
keeps new subscriptions on the old behavior, and their comment gives the same two reasons.
Adopting `flexible` instead would be a legitimate product choice, but not one an upgrade PR can
make silently: it also needs changes to the plan-change and cancellation code, and it can't be
undone per subscription.

#### `managed_payments`: not required, no runtime change

The parent already sent `managed_payments: { enabled: false }` on every Checkout Session,
through a local `interface CheckoutSessionCreateParams extends
Stripe.Checkout.SessionCreateParams { managed_payments?: ManagedPaymentsSetting }`, because
"this SDK major does not type it yet". stripe-node 22.1.0: "Add support for `managed_payments`
on `Checkout.SessionCreateParams`". Stripe's changelog files Managed Payments under
`2026-02-25.clover` as non-breaking. The human swapped the local type for
`Stripe.Checkout.SessionCreateParams.ManagedPayments`. The request body is byte-for-byte the
same, and the old interface still compiles: its `{ enabled: boolean }` is assignable to the
SDK's `{ enabled?: boolean }`. **That's why every arm left it and every check passed. It is a
type cleanup, not an escaped regression**, and it should leave the candidate list.

#### Provisioning: the registration half of `billing_mode`

`provisioning.ts` loses `buildSubscriptionCreateParams` to a new
`workspaces/subscription-create-params.ts`. The function is unchanged except for the added
`billing_mode`, and `payment_behavior: "default_incomplete"` with its comment moves verbatim.
The move is a refactor, so the new test can import the builder. The behavior change is the
`billing_mode` above, on the registration path.

#### Also in the commit: `allowed_payment_method_types`, a forward-looking product choice

`createCardSetupIntent` swaps `payment_method_types: ["card"]` for `allowed_payment_method_types`.
The removal it anticipates ("Passing `payment_method_types` now returns a 400 error with the code
`payment_method_types_no_longer_supported`") is published for `2026-08-26.preview` and
`2026-09-30.endive`, not for `2026-08-26.dahlia`. 22.6.2 still types `payment_method_types?` on
`SetupIntentCreateParams` without a deprecation, and the human's own comment says "from API
version 2026-08-26.preview on". The pinned version doesn't require it. It will be required at
endive, and it isn't quite equivalent: "Stripe filters out incompatible types instead of
returning an error."

### What the cases say

| change | required by the upgrade? | where the reason is published | compile-time trace |
|---|---|---|---|
| calmcp `additionalProperties: false` | yes | zod JSON Schema docs + the MCP SDK's converter code | none |
| calmcp server-side rejection | no, a product choice | — | — |
| dms-saas `billing_mode: classic` | yes | Stripe API changelog (clover, breaking) | none |
| dms-saas `managed_payments` type | no, a type cleanup | stripe-node 22.1.0 CHANGELOG | none needed |
| dms-saas provisioning move | no, a refactor | — | — |
| dms-saas `allowed_payment_method_types` | not yet (endive) | Stripe API changelog (preview, endive) | none |

So the bench has two silent changes the upgrade requires, not four. They fail in different
places:

- **Stripe: the source was already in hand.** Round 4's PR body lists "Makes flexible billing
  mode the default for new subscriptions — breaking; Billing, Checkout" in the collapsed "Other
  changes to resources you use (no code evidence)", 1 of 105. The headline above it says
  "230 API changes, none affect your code". The agent's decision line even names "billing mode
  default flexible" in a list of things to review. Uptide fetched the reason, failed to match it
  to `provisioning.ts:355`, and then told the reader nothing was affected. Matching looks for
  fields an entry renames or removes. A default flip's usage site is a call that **omits** the
  parameter.
- **zod: the source was never read.** Nothing Uptide fetches says what a JSON Schema converter
  emits, and the change only matters because a *third* package (the MCP SDK) converts the
  user's schemas. The site is `registerTool({ inputSchema })`, a call into the MCP SDK, not
  into zod.

## Inventory: what Uptide already reads and computes

Read from the code at `4accd66`.

- **Stripe API changelog** (`scripts/build-stripe-changelog.ts`, `packs/stripe/changelog.v1.json`).
  - **Fetched at maintenance time, never at runtime.** `pnpm build:stripe-changelog` reads
    `docs.stripe.com/changelog.md` and checks in 972 entries (generated 2026-10-01, newest
    `2026-09-30.endive`).
  - **Index row only.** Each entry keeps title, URL, products, a breaking flag and a
    precomputed `touches`. The entry page's body, the text that says *what* changed, is never
    read.
  - **Range.** `between()` keeps `from < version <= to` and drops `.preview` entries. That's why
    the `payment_method_types` removal (filed under `2026-08-26.preview`) correctly doesn't
    reach a dahlia upgrade.
  - **Where it stops: matching.**
    - `entryTouches()` derives fields from title and URL tokens. The clover entry has
      `{ resources: ["subscription"], fields: [] }`, and so does the `iterations` removal.
    - `evidencedEntries()` needs a field or param named in the entry, or a compiler error at
      the site, so a default flip can never be evidenced.
    - It lands in `resourceEntries()`, labelled "Not evidence", collapsed in the PR body
      (20 shown of N).
    - `apiChangeSummary()` then prints "none affect your code".
  - **Defects found on the way:**
    - 80 of 972 precomputed `touches` differ from what the current `entryTouches` computes.
    - Regenerating would add a spurious `meter` resource to every title containing
      "parameter".
    - Method evidence never matches, because no entry has `methods`.
- **Agent context** (`fix/sdk-agent.ts:331-395`).
  - **What it gets.** Every task gets the whole `reviewSections` output under "Changelog
    entries:" (evidenced, resource and other lists, untruncated), plus `meta.sources` and the
    pack's decisions.
  - **What it doesn't get.** The per-site evidenced lines that `pack.guide()` builds; they
    reach only the legacy patch executor.
  - **Where it stops.** The agent had the billing-mode title as one line among about 230, with
    no site attached. It mentioned it as something to review, and changed nothing.
- **Surfaces** (ADR 0003, `domain/surface.ts`, `SURFACE_SCHEMA_VERSION = 10`).
  - **What it reads.** The d.ts walk reads `@deprecated` and `@internal`, and no other JSDoc.
  - **Where it stops.** A default that changes under an unchanged type produces no surface
    change; `billing_mode` is identical in 18.5.0 and 22.6.2.
  - **Cache.** `<cache>/surfaces/<adapter>/v<schema>/<pkg>/<version>.json`, invalidated only by
    a schema bump.
- **Registry and tarballs** (`fetch/npm-fetcher.ts`).
  - **Cache layout.**
    - Packuments: `<cache>/registry`; exact versions are kept forever, dist-tags for 1 h.
    - Tarballs: `<cache>/tarballs`, integrity-checked.
    - Full extractions: `<cache>/extracted/<pkg>/<version>/`, with a completion marker.
      ADR 0003 still says extracted dirs are removed; they are kept.
  - **Where it stops.** The `CHANGELOG.md` and README of both versions are on disk for every
    upgrade, and nothing reads them.
- **Possible impact** (UPT-97, `check/tier.ts:68-88`).
  - **What it counts.** `confirmBreaking()` demotes a breaking surface change with no compiler,
    probe or pack evidence to "possible impact": a count with no prose and no source.
  - **Where it stops.** Built only from the type surface, so a silent change never reaches even
    this tier.
- **Runtime probes.**
  - **Signal C** (`runtime/probe.ts`): records the export shape only.
  - **Zod differential** (`fix/behavior.ts`, `fix/behavior-probe.ts`):
    - Runs only for zod, only in `fix`, only on top-level schema bindings at reported sites.
    - Compares `safeParse` on about 200 generated inputs, including an extra key, between
      `zod/v3` (as shipped inside zod 4) and `zod`.
  - **Where it stops.** It probes the target's own API, never a consumer's use of it (here the
    MCP SDK's `toJSONSchema` call). It isn't scored against ground truth.
- **Decisions and citations.**
  - **PR body.** Already has `### Decisions for you` (`fix/report.ts:1305-1329`): the agent's
    structured `decisions`, the pack's `decisions()` hook, the headline decision. "Worth a
    look" carries the zod differential.
  - **Citations.** Packs cite `meta.sources` (title and URL, with the read date by convention).
    Rules have no per-rule source; only `PackCompanion.source` is per item.
- **Measurement.**
  - **Ground truth.** `packs/<pack>/ground-truth.json` lists `findings[{ file, line, rule }]`.
  - **Scoring.** `pack test` scores breaking and behavior-note sites. `verifiedGate()` needs
    2 or more public repos, 0 breaking FP, 5 or more sites, and 0 FP on notes and mechanical
    rules.
  - **Where it stops.** A `decision`-only note is never a predicted site, so it can only score
    as a false negative. Nothing scores the changelog lists, the zod differential, or the
    agent's decisions.
  - **Bench.** The bench scorer (`bench/score.mjs`) lives on #169's branch, not on main.
- **Privacy** (`docs/privacy.md`).
  - **Network use today.** The registry, the one-time SDK download, npm advisories (public
    names only), opt-in telemetry and GitHub for `--pr`. "There is no Uptide server." The agent
    session has no web tool.
  - **What a runtime fetch of docs would mean.** A new network use that needs the statement
    updated. Reading a `CHANGELOG.md` from a tarball already in the cache needs none.

## Decision

A silent behavior change becomes a finding only when two things hold:

1. **A cited source line:** a verbatim quote from a published, public source.
2. **A usage site:** a place in the repository, resolved by the type checker, where the quoted
   behavior applies.

Missing either, it is context at most: never counted, never in the headline, never "affects
your code". The rest of this section is how each half is obtained.

### 1. Sources, fetching and caching

**Public package data only, never customer code.** Sources are fetched and processed without
any repository content. Matching runs locally, like every other analysis.

| source | when it's read | how it's cached | used for |
|---|---|---|---|
| Vendor API changelog entry pages (Stripe's `.md` bodies: "What's new", "Why is this a breaking change?", "Impact") | maintenance time, by the build script that already fetches the index | checked in next to `changelog.v1.json`: URL, retrieved date, sha256 of the page, the extracted record | behavior records (§2) |
| Migration guides and docs pages (zod's JSON Schema page, Stripe's billing-mode comparison) | pack-authoring time | same: URL, read date, sha256, quote | behavior records |
| A consumer package's code that branches on the target's major (the MCP SDK's `zod-json-schema-compat.js`) | pack-authoring time, from the consumer's published tarball | consumer name, version range, file and line in the record | cross-package records |
| `CHANGELOG.md` of the installed and target versions | runtime, from `<cache>/extracted` (no new network) | already cached | agent context and generic candidates (§2), never findings by itself |

- **No runtime fetch of docs.** That keeps `docs/privacy.md` true as written. A stale record is
  handled like a stale changelog index today: the build fails when the target API version is
  absent.
- **Release notes on GitHub** are treated as docs pages: fetched at authoring time, cited by
  URL.

### 2. Extraction: behavior records

A record is the unit between a source and a site, checked in per pack:

```jsonc
{
  "id": "stripe/billing-mode-default-flexible",
  "range": { "apiVersion": { "from": "<2025-09-30.clover", "to": ">=2025-09-30.clover" } },
  "source": {
    "url": "https://docs.stripe.com/changelog/clover/2025-09-30/billing-mode-default-flexible.md",
    "read": "2026-10-18",
    "sha256": "…",
    "quote": "Subscriptions you create through the API now default to flexible billing mode."
  },
  "trigger": {
    "kind": "omits-property",
    "types": ["Stripe.SubscriptionCreateParams", "Stripe.Checkout.SessionCreateParams.SubscriptionData"],
    "property": "billing_mode"
  },
  "effect": "New subscriptions use flexible billing: no immediate invoice on a free-to-paid upgrade, portal cancellations set cancel_at, not cancel_at_period_end.",
  "keepOld": { "edit": "billing_mode: { type: 'classic' }", "exact": true },
  "alsoRead": ["Stripe.Subscription#cancel_at_period_end"]
}
```

- **`source.quote` must be a verbatim substring of the page** whose sha256 is recorded. A
  contract test checks it, as `companionProblems()` checks companion sources today. No quote,
  no record.
- **Who drafts the records.**
  - Stripe: the build script fetches the body of each **breaking** entry in the catalog. It
    proposes a record when the body says what a default or serialization becomes. A pack author
    accepts or rejects each one, and an LLM may draft them, on public text only.
  - Other packs: records are written by hand from the guide, like rules are today.
- **Trigger kinds, smallest set that covers the cases:**
  - **`omits-property` and `passes-property`:** an object literal whose contextual type is the
    named params type, with or without the property, or with a given value.
    - Contextual typing catches `buildSubscriptionCreateParams()`'s return literal and Checkout's
      `subscription_data` (`workspace-checkout.ts:211`), not just literals written inline in the
      call.
    - A later assignment to the property on the same binding counts as passing it
      (`subscriptionData.trial_period_days = …` is the pattern).
    - A spread of something the checker can't see through makes the site unknown, and an
      unknown site is no finding, in the spirit of ADR 0004.
  - **`flows-to-consumer`:** a value of the target's type passed to a consumer function. An
    example is a zod object without a `never` catchall passed as `inputSchema` to
    `McpServer#registerTool` or `#tool`, with `@modelcontextprotocol/sdk` in a stated range.
    The record names both packages and both ranges, and is skipped when the consumer isn't
    installed.
- **`keepOld`:** the edit that restores the old behavior, and whether it does so *exactly*.
  - `billing_mode: classic` is exact.
  - `.strict()` is not: it restores the advertised schema and adds a server-side rejection.
- **`alsoRead`:** lists code that depends on the old behavior (the `cancel_at_period_end`
  reads). Those sites are shown under the finding, never as findings of their own.
- **Generic tier.** Lines in the `CHANGELOG.md` range that name an exported symbol the repo
  uses, and say "default", "no longer", "now", "instead of" or "silently", become agent context
  with the line quoted. They are never findings until a record exists.

### 3. Matching to usage sites

Records run in `check` and `fix` after the usage analysis, on the same project. Each match is a
site with `{ file, line, record, kind: 'behavior' }`, ranked with breaking findings but counted
separately.

- **A matched record is lifted out of the "no code evidence" list.** It never stays there
  collapsed.
- **`resourceEntries()` stays** as uncounted context.
- **The PR headline and the Behavior cell count matched records.** "None affect your code" may
  be printed only when none matched.

### 4. How findings reach the agent and the PR body

- **Agent.**
  - **What the prompt carries.** Each task gets a `Behavior changes at these sites` block: the
    site, the quote, the URL, `effect`, `keepOld`, `alsoRead`. This replaces the flat
    230-line changelog dump for matched entries; unmatched ones stay as today.
  - **What the agent must do.** For each matched site it either applies `keepOld`, or records a
    decision naming the record id.
  - **Mechanical check after the session.** Every matched site carries the edit or a decision.
    Otherwise the finding stays open.
- **PR body, applied.** When `keepOld.exact` holds, the default is to keep the old behavior: an
  upgrade PR doesn't change product behavior unasked, as the API version pin already doesn't.
  - The edit is applied mechanically and listed under "What changed" as **Kept**:
    "`billing_mode: { type: 'classic' }` at `provisioning.ts:355`, `workspace-checkout.ts:211`".
  - It carries the quote and the link, and one line on what adopting the new default would
    take, with the `alsoRead` sites.
- **PR body, decision for you.** When there is no exact `keepOld`, or keeping it changes
  something else, the finding goes under "Decisions for you". It always carries the cited
  source line, the sites, the recommended option and what it changes. calmcp's `.strict()`
  is the example:
  - Restores `additionalProperties: false`.
  - Also rejects unknown keys server-side, which neither version did.
- **Product choices are never presented as required.** `managed_payments` and
  `allowed_payment_method_types` would not be findings under this rule:
  - `managed_payments` has no behavior change.
  - `allowed_payment_method_types` isn't in the pinned version's range.

### 5. The false-positive rule

- **A finding needs both conditions:** a usage site resolved by the checker, and a source line
  that the contract test proves is in the cited page.
- **Precision gate.** A record whose matches have any false positive on ground truth is held at
  `candidate` and shown as context only, like a pack's unverified rules. This is the
  `verifiedGate()` 0-FP rule applied to records.
- **No severity inflation.** A record never raises a site to breaking. It is its own class,
  `behavior`, kept out of the breaking count and the breaking precision.

### 6. Measurement

- **Ground truth.** `ground-truth.json` gains `silent[{ file, line, record, kind: 'required' |
  'product-choice' }]` per repo.
  - From the cases above: dms-saas `provisioning.ts:355` and `workspace-checkout.ts:211`
    (required), and the five calmcp `registerTool` calls (required).
  - The bench's `managed_payments` and `allowed_payment_method_types` go in as product-choice.
    A finding that calls them required is a false positive.
- **`pack test`.** Gains a `silent` block (TP, FP, FN, precision, recall) next to `breaking`
  and `behavior`. Records make decision-like knowledge scorable at last: they predict sites.
- **Bench.** `score.mjs` gains a **silent changes caught** column per run: the ground-truth
  silent sites where the arm's diff applies `keepOld`, or its PR body carries a decision citing
  the record. A **silent FP** column counts behavior findings in the PR body that aren't in
  ground truth.
  - A release may quote the caught number only with silent FP at 0 on the bench repos.
  - Claude Code arms are scored by the same columns, so the comparison holds.

## Consequences

- **Stripe's gap is matching and presentation, not sourcing.** The billing-mode entry is
  already bundled. What's missing is the entry body, the `omits-property` trigger and a
  headline that stops saying "none affect your code" while a matched record exists.
- **Zod's gap is sourcing.** It needs a cross-package record citing the consumer's converter.
  The zod differential could extend to the consumer's serialization (old vs new
  `toJSONSchema` through the SDK's own path) as a check on that record. It would not be a
  source in its own right.
- **No new network use at runtime.** The authoring scripts fetch public docs; `privacy.md`
  doesn't change.
- **Every record is maintenance.** It names a source page that can move, and the sha256 makes a
  moved page visible at the next regeneration rather than silently.
- **The bench's candidate list shrinks from four to two.** That's the honest denominator.

## Follow-up work

**UPT-113: Stripe behavior records (matching, PR body, measurement)**

1. **Records.** Extend `build-stripe-changelog.ts` to fetch the body of every breaking entry,
   store it with its sha256, and draft records. Check in the clover `billing-mode-default-flexible`
   record, plus any other default flip in the bundled range that a pack author accepts.
2. **Defects.** Fix the stale `touches`, and the `meter`-in-"parameter" match before
   regenerating.
3. **Matching.** The `omits-property` and `passes-property` triggers, using contextual types,
   in `check` and `fix`.
4. **Agent.** The `Behavior changes at these sites` block, and the post-session check: edit
   applied or decision recorded.
5. **PR body.** "Kept" lines with quote and link. "Decisions for you" for non-exact records.
   Headline and Behavior cell count matched records, and "none affect your code" only when
   none matched.
6. **Measurement.**
   - `silent` in ground truth and `pack test`, with the 0-FP gate.
   - dms-saas silent sites recorded.
   - The bench's silent-caught and silent-FP columns, scored for both repos; calmcp scores
     0 caught until UPT-114.
7. **Done when** a dms-saas rerun keeps `billing_mode: classic` at both creation paths, citing
   the clover entry, with 0 silent FP on the stripe ground-truth repos.

**UPT-114: cross-package records and the generic tier (zod and the MCP SDK)**

1. **Record format.** The `flows-to-consumer` trigger: target and consumer, both with ranges.
   The calmcp record cites zod's JSON Schema docs line and the SDK 1.30.1 `toJsonSchemaCompat`
   lines, matching non-strict objects passed to `registerTool` or `tool`.
2. **Decision.** Its "Decisions for you" text spells out both behaviors: the advertised schema,
   and server-side rejection.
3. **Probe.** Optionally, extend the zod differential to serialize sliced schemas through the
   consumer's converter on both versions, as a check that the record's effect holds at those
   sites.
4. **Generic tier.** Read the `CHANGELOG.md` range from the extracted tarballs, and pass lines
   that name used symbols to the agent as quoted context. Never findings.
5. **Measurement.** calmcp silent sites recorded in ground truth, and scored in the bench
   column.
6. **Done when** a calmcp rerun shows the decision at the five `registerTool` sites with both
   cited sources, with 0 silent FP.
