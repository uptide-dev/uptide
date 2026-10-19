# Silent changes in UpgradeBench

`score.mjs`, its tests and `selection.json` originate in #169's
`bench/upgradebench-v0-pilot` branch at `339e306`. The same scorer applies to all arms.
The harness (`run.sh`, `check.sh`, `judge.sh`) remains on that branch; run only against
forks in `uptide-bench`. No CI polling is needed to query a PR's mergeability.

The dms-saas ground truth is fixed before scoring, from ADR 0017 and the human's
`f992f335089cfb17ca2b86d8d9d6a908ddbaee2a` change:

- `packages/dms-saas/src/workspaces/provisioning.ts:355`: subscription creation;
  its preserving edit belongs in `buildSubscriptionCreateParams`, lines 292–303.
- `packages/dms-saas/src/stripe/workspace-checkout.ts:211`: Checkout subscription
  data, shared by the primary and retry session-creation calls.

Both require `billing_mode: { type: 'classic' }`. The provisioning extraction is a
refactor, not a third silent change. `managed_payments` is a type cleanup; the
`allowed_payment_method_types` change applies to a later API version. Neither is
required by this upgrade. Unexpected behavior record sites remain silent FPs.

An edit must touch the declared site (or its declared builder range) and contain
the preserving value. A decision must name both the record and the concrete site;
naming a record once does not credit every site. Do not revise these expectations
after scoring a run.
