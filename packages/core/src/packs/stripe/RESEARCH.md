
## Clover silent billing default (UPT-113)

`records.json` pins the clover changelog body and the billing-mode comparison page
under `sources/`. `build:stripe-changelog` checks their SHA256 and verbatim quotes
before writing the catalog; source drift requires an explicit author review.
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
