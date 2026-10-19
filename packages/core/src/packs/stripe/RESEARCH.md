
## Clover silent billing default (UPT-113)

`records.json` stores only quoted lines, URLs, read dates and full-page SHA256
hashes for the changelog, comparison and API reference pages.
`build:stripe-changelog` fetches those pages, verifies hashes and quotes before
writing the catalog, and caches pages in gitignored `.cache/stripe-sources/`.
Drift fails the build and requires explicit author review of the quote and hash.
Contract tests validate source metadata offline; the maintenance build verifies
the full external pages. Existing vendored zod sources retain their offline checks.
There is no runtime docs fetch.

The trigger resolves Stripe's create signatures, local object bindings, spreads,
and single-return builders. A Checkout wrapper must forward its parameter to a
real SDK Checkout create call, and its caller must select subscription mode.
Unresolved subscription parameters become decisions, never preserving edits.
Explicit classic and flexible settings are left alone. Unknown Checkout mode is
not enough evidence that a subscription is being created.

The preserving edit is on subscription creation (nested in `subscription_data`
for Checkout). Updates do not change an existing subscription's billing mode just
because the request API version changes. The comparison page says flexible
subscriptions cannot migrate back to classic; its portal section says scheduled
cancellations use `cancel_at`. Consequently there is no universal preserving edit
on `subscriptions.update` or portal-session creation. The cited decision/adoption
text asks the owner to review invoice timing and cancellation readers if they
choose flexible; those calls alone are not independent findings (ADR 0017's
usage-site requirement). This avoids treating every update or portal session as
an affected new subscription.

Post-session reporting marks a Stripe site kept only after resolving an explicit
classic value at the matched call. Disappearance, unresolved parameters, and an
explicit flexible value are not proof of a preserving edit.


### Coverage and request API versions (#253 review)

The six APIs listed in the pinned changelog are covered. The API references read
on 2026-10-18 establish these preserving parameter paths:

| API | Preserving parameter / decision |
| --- | --- |
| subscriptions.create | billing_mode.type = classic |
| subscriptionSchedules.create | billing_mode.type = classic, only for a new subscription |
| invoices.createPreview | subscription_details.billing_mode.type or schedule_details.billing_mode.type, only when previewing creation |
| quotes.create | subscription_data.billing_mode.type; absent subscription context requires a decision |
| checkout.sessions.create | subscription_data.billing_mode.type, with mode proven subscription |
| paymentLinks.create | Decision: the API reference exposes no billing_mode parameter; review recurring prices and Dashboard billing mode settings |

The parameter paths are quoted in records.json with their reference URLs. For
Payment Links see https://docs.stripe.com/api/payment-link/create.md?query= and the
pinned changelog's account-wide Billing Settings instructions. A schedule with
`from_subscription` operates on an existing subscription and forbids additional
parameters. A preview with `subscription` or `schedule` uses the existing object;
neither is a new default-billing-mode finding.

The SDK range is deliberately only a candidate filter (`from: *`, `to: >=19`);
the pack supports SDK 12 and later. Request API versions decide whether a site
crosses 2025-09-30.clover. A retained explicit pin generates no finding. The fix
pipeline reuses its API client inventory and selected API-version migration sites
to include clients whose pins will move, then verifies the actual pin afterwards.
Payload `api_version` fixtures do not move request clients. Multiple clients are
resolved by the call's receiver, not by a repository-wide maximum version.
Unresolved request configuration requires a decision. Per-request explicit
API-version overrides remain pinned.

### Independent dms-saas parent audit (before scoring)

Audited parent `6390f434622db5d6e546854b435fb1017c3cc665` and the human upgrade
`f992f335089cfb17ca2b86d8d9d6a908ddbaee2a` (PR #70). No ground truth was changed.
The additional calls are:

- `packages/dms-saas/src/stripe/plan-schedule.ts:52`: schedules an existing
  subscription with `from_subscription`; no new billing default applies.
  PR #70 changes the later phase's iterations to duration, not this creation call.
- `packages/dms-saas/src/stripe/upcoming-invoice.ts:107`: previews an existing
  `subscription`; the human diff makes no change here.

There are no quotes.create or paymentLinks.create calls. Checkout's two direct
SDK calls at workspace-checkout.ts:238 and :245 are the retry paths of the same
wrapper; the proven subscription caller uses the builder at :211. The other
creation site remains provisioning.ts:355. Both are already in the frozen bench
truth, derived from the human upgrade. No extra silent-change site is warranted
by the cited source, and no Uptide output was used to add expected sites.
