# Compare classic and flexible billing mode

Learn about the differences between the various billing modes

We recommend using [flexible billing mode](https://docs.stripe.com/billing/subscriptions/billing-mode.md) because it provides improved billing behavior and access to new features. However, moving to flexible billing mode can change your integration’s behavior. Review the following differences to understand the impact on your integration and make an informed decision.

> You can’t migrate a subscription from flexible billing mode to classic billing mode.

Use this page to understand what changes when you migrate a subscription from classic to flexible billing mode. Each section describes a specific behavior difference so you can assess the impact on your integration before migrating.

## Credit proration calculations

Credit prorations are issued when customers downgrade their subscriptions or cancel subscription items before the end of their billing period. Flexible billing mode calculates credit prorations based on the original amount previously debited to a customer.

For a full overview of credit proration calculations, see [Credit prorations](https://docs.stripe.com/billing/subscriptions/prorations.md#credit-prorations).

| **Classic** | **Flexible** |
| --- | --- |
| When an update to a subscription generates a credit proration, the credit proration amounts are calculated based on the value of the subscription item’s current price, tax, quantity, and the last discounts used. | When an update to a subscription generates a credit proration, these prorations use the original debited amount instead of current subscription values. If the time period being credited was originally billed across multiple debits, Stripe generates multiple credit prorations: one for each corresponding original debit. |

### Proportional discount application for prorations

We apply discounts proportionally to each subscription item during [proration calculations](https://docs.stripe.com/billing/subscriptions/prorations.md#prorations-and-discounts) instead of distributing them evenly. This results in more prorations, especially when invoicing on a per-item basis or canceling items with unevenly distributed discounts.

| **Classic** | **Flexible** |
| --- | --- |
| We distribute discounts evenly across all subscription items. | We apply discounts proportionally to each subscription item during proration calculations. |

## Usage-based pricing

### Suppress zero-amount line items when adding usage-based items

Flexible billing mode doesn’t create zero-amount line items when you add usage-based items to a subscription. If the invoice is empty as a result, we don’t generate one.

For example, when adding a monthly usage-based item during subscription creation or update:

| **Classic** | **Flexible** |
| --- | --- |
| A 0 USD line item is generated on the invoice for the usage-based item. This also applies when updating a subscription without cycling to add a usage-based item while using `proration_behavior=always_invoice`. | A 0 USD line item isn’t added to the invoice for the usage-based item. If the resulting invoice wouldn’t contain any items, we don’t generate one. |

However, this doesn’t apply to invoices generated during cycling. The invoice contains all usage-based items, including 0 USD line items.

### Bill usage-based items based on price at time of reporting

Flexible billing mode charges for usage based on the price that was in effect when the usage was reported, rather than the most recent price.

For example:

1. Initially, the price is 0.1 USD per 100 API calls (Price A)
2. Usage on January 5: 1000 API calls
3. On January 15, the price changes to 0.15 USD per 100 calls (Price B)
4. Usage on January 20: 500 API calls

| **Classic** | **Flexible** |
| --- | --- |
| Stripe only bills for the usage that was reported since changing to the current price.

- 500 API calls at Price B (0.15 USD per 100 calls) = 0.75 USD

Total invoice amount = 0.75 USD. | Stripe bills for all usage in the current period at the price effective at the time it’s reported.

- 1000 API calls at Price A (0.1 USD per 100 calls) = 1 USD
- 500 API calls at Price B (0.15 USD per 100 calls) = 0.75 USD

Total invoice amount = 1.75 USD. |

### Bill for unbilled usage when removing usage-based items

Depending on the value of `proration_behavior`, flexible billing mode might generate an invoice item for unbilled usage when removing a usage-based subscription item. This applies to removals using the API or during schedule phase transitions that occur mid-period. For phase transitions that coincide with any subscription item `current_period_end`, an invoice gets created with an invoice line item for the removed usage-based subscription item.

| **Scenario** | **Classic** | **Flexible** |
| --- | --- | --- |
| Update subscription or schedule using the API | No invoice item or invoice is generated for unbilled usage when removing a usage-based subscription item. | An invoice item is generated for unbilled usage when removing a usage-based subscription item. |
| Schedule phase transition | An invoice (but no invoice item) is generated for unbilled usage when removing a usage-based subscription item. | Depending on the incoming phase’s `proration_behavior`:
- `create_prorations`: an invoice item is created for unbilled usage when removing a usage-based subscription item.
- `always_invoice`: an invoice item for unbilled usage is created and immediately invoiced.
- `none`: no invoice item is created. |

### Reset the billing cycle anchor

Flexible billing mode only resets your [billing cycle anchor](https://docs.stripe.com/billing/subscriptions/billing-cycle.md) on subscription updates when you explicitly set `billing_cycle_anchor` to a value other than `unchanged`.

| Classic | Flexible |
| --- | --- |
| The `billing_cycle_anchor` is automatically reset to the current date when switching a subscription to a different price with a different recurring interval, changing from zero-amount prices to non-zero prices, or moving [cancel_at](https://docs.stripe.com/api/subscriptions/object.md#subscription_object-cancel_at) to a date before the next time the subscription renews. | The `billing_cycle_anchor` is never automatically reset. When a customer upgrades from a free plan to a paid plan, Stripe creates pending invoice items but doesn’t immediately generate an invoice or attempt a charge. Instead, those items are included on the next billing cycle invoice, giving you time to collect a payment method if the customer doesn’t already have one attached.

To immediately generate an invoice on a free-to-paid upgrade, pass `proration_behavior=always_invoice` or explicitly reset the billing cycle anchor by setting `billing_cycle_anchor=now`. |

### Cancel out equivalent prorations on billing cycle anchor resets

When you reset the billing cycle anchor without changing subscription items, Stripe cancels out equivalent credits and debits, generating only the net remaining debit as a proration invoice item.

For example, consider a monthly subscription created on September 1 with its billing cycle anchor reset on September 15 (no item changes):

| `proration_behavior` | **Classic** | **Flexible** |
| --- | --- | --- |
| `create_prorations` | - Stripe generates a full-period debit for September 15 to October 15 as an invoice line item
- Stripe generates a credit for September 15 to October 1
- Stripe creates an invoice immediately | - Stripe cancels out the credit and debit for September 15 to October 1
- Stripe generates a debit for October 1 to October 15 as a `proration=true` invoice item
- Stripe doesn’t create an invoice immediately |
| `always_invoice` | - Stripe generates a full-period debit for September 15 to October 15 as an invoice line item
- Stripe generates a credit for September 15 to October 1
- Stripe creates an invoice immediately | - Stripe cancels out the credit and debit for September 15 to October 1
- Stripe generates a debit for October 1 to October 15 as a `proration=true` invoice item
- Stripe creates an invoice immediately |
| `none` | - Stripe generates a full-period debit for September 15 to October 15 as an invoice line item
- Stripe filters out the credit for September 15 to October 1
- Stripe creates an invoice immediately | - Stripe doesn’t generate any invoice items or invoice |

If you also change subscription items alongside the BCA reset such that the prorations don’t fully cancel out, flexible mode generates a full-period invoice line item and creates an invoice immediately, regardless of `proration_behavior`.

### Consolidated invoicing for subscription schedule phase transitions with usage-based items

Flexible billing mode consistently generates a single invoice when a subscription renews. This change eliminates separate invoices for removed usage-based items and improves billing consistency.

When your subscription with usage-based items transitions between phases:

| **Classic** | **Flexible** |
| --- | --- |
| Two invoices are generated. | A single consolidated invoice is generated. This invoice includes both usage-based and licensed items, applies discounts from the previous phase to usage-based billing, and uses tax rates from the next phase. |

## Scheduled subscription cancellation

### Cancellations in the Customer Portal

When a customer schedules a cancellation through the [Customer Portal](https://docs.stripe.com/customer-management/cancellation-page.md), flexible billing mode uses `cancel_at` directly rather than `cancel_at_period_end`. For more information on the differences between `cancel_at` and `cancel_at_period_end`, see [the changelog](https://docs.stripe.com/changelog/basil/2025-07-30/cancel-at-enums.md).

| **Classic** | **Flexible** |
| --- | --- |
| `cancel_at_period_end` is set to `true` and `cancel_at` is set to the `current_period_end` timestamp. Because `cancel_at_period_end` is `true`, `cancel_at` updates whenever `current_period_end` changes. | `cancel_at_period_end` is set to `false` and `cancel_at` is set to the maximum `current_period_end` across all subscription items. When an item’s `current_period_end` changes, the cancellation date (`cancel_at`) isn’t updated. |

### Excluding prorations for the first truncated billing period

If you set cancel_at when creating a subscription and it shortens the first billing period, the effect of [disabling prorations](https://docs.stripe.com/billing/subscriptions/prorations.md#disable-prorations) depends on the subscription’s billing mode.

| **Classic** | **Flexible** |
| --- | --- |
| Stripe doesn’t treat the shortened billing period as a proration. As a result, setting `proration_behavior=none` doesn’t prevent Stripe from invoicing for that period. Stripe adds an invoice line item for the subscription’s full amount, not the prorated amount. | The shortened period is treated as a proration. `proration_behavior=none` suppresses the line item entirely, so no invoice is created and `latest_invoice` is `null`. |

For subscription updates, Stripe only applies this behavior when the update creates an invoice. For example, when you explicit `billing_cycle_anchor` reset or a [free trial](https://docs.stripe.com/billing/subscriptions/trials/free-trials.md) ending.

## Backdate subscriptions

When [backdating](https://docs.stripe.com/billing/subscriptions/backdating.md) is consistent with regular billing, flexible billing mode creates separate invoice line items for each billing period within the backdated range. It also automatically aligns the billing cycle anchor to the `backdate_start_date` when not explicitly set. Backdating isn’t supported if the resulting invoice has more than 250 line items.

For example, a subscription needs to be backdated due to a missed invoice for the past two billing periods. The customer was invoiced for 2 different backdated periods:

- Billing Period 1 (March 1 - March 31):
  - Usage reported: 100 GB of storage used.
  - Price: 10 USD per 10 GB.

Billing Period 2 (April 1 - April 30):

- Usage reported: 150 GB of storage used.
- Price: 10 USD per 10 GB.

The service provider decides to backdate the invoice to cover both billing periods: March 1 to April 30.

| Classic | Flexible |
| --- | --- |
| Charges for the entire backdated period are calculated collectively as a single line item. Total charges:
- 250 GB = 25 x 10 USD = 250 USD
- This amount appears as a single line item on the invoice. | Backdated time ranges are split into multiple invoice line items according to billing period boundaries. Total charges:
- Billing Period 1 (March):
  - 100 GB = 10 x 10 USD = 100 USD (as a separate line item).
- Billing Period 2 (April):
  - 150 GB = 15 x 10 USD = 150 USD (as a separate line item). |

### Subsequent proration behavior after backdating without an initial charge

When you create a backdated subscription with `proration_behavior: 'none'` to suppress invoicing for the backdated periods (for example, when [migrating to Stripe](https://docs.stripe.com/billing/subscriptions/backdating.md#backdating-no-charge)), flexible billing mode and classic billing mode handle subsequent updates and cancellations differently.

| **Classic** | **Flexible** |
| --- | --- |
| When you update or cancel the subscription later, Stripe generates a credit proration for the remaining unused time in the backdated period, even though no invoice was created for those billing periods. | Because flexible billing mode calculates credit prorations based on previously debited amounts, no debit for the backdated periods means no credit proration is generated for that time for subsequent updates or cancellations. |

## Trials

### Update trial start date for subsequent trials

Flexible billing mode uses the most recent trial start date for subscriptions with subsequent trials.

For example, when you have:

- Trial period from January 1st to February 1st
- Normal billing period from February 1st to March 1st
- Trial period from March 1st to April 1st

| **Classic** | **Flexible** |
| --- | --- |
| The `subscription.trial_start` always refers to the first trial a subscription started. | The `subscription.trial_start` refers to the start of the most recent trial of a subscription. |

### Preserve original trial end date when subscription cancels

Flexible billing mode preserves the `trial_end` if you modify the `cancel_at` date.

| Classic | Flexible |
| --- | --- |
| Setting `cancel_at` to a date earlier than the `trial_end` date automatically changes `trial_end` to match `cancel_at`. However, removing `cancel_at` or changing it to a date later than the `trial_end` date doesn’t automatically change `trial_end`, even if `trial_end` was originally a later date. | Scheduling a subscription cancellation using `cancel_at` no longer alters the `trial_end` date. This ensures that trials run for their intended duration regardless of cancellation date updates. |

### Standardize trial period line item description

Flexible billing mode uses a consistent description format for both usage-based and licensed items during trial periods.

For example, when you have a monthly coffee subscription (licensed) and an `hypernian_tokens` subscription (usage-based), the subscription description displays as following:

| **Classic** | **Flexible** |
| --- | --- |
| Licensed items use the template `Trial period for {product name}`, while usage-based items use `{quantity} x {product name} (Free trial)`.

- For licensed items:
  - `Trial period for monthly coffee subscription`
- For usage-based items:
  - `10 x monthly hypernian_tokens  (Free trial)` | The same format, `Free trial for {quantity} x {product name}`, applies to all item types, which provides a more uniform presentation of trial information. These descriptions are also localized.

- For licensed items:
  - `Free trial for 1 x monthly coffee subscription`
- For usage-based items:
  - `Free trial for 10 x monthly hypernian_tokens subscription` |

### Re-bill for trial line items

Flexible billing mode only generates line items for changes made during a trial. Existing items without changes aren’t rebilled.

For example, when you make an update to add another trialing item `price_b` to a trialing subscription with `price_a`:

| Classic | Flexible |
| --- | --- |
| Changes during a trial result either in no invoice or in an invoice that restates the entire state of the subscription. | Changes during a trial consistently result in line items comparable to changes outside of a trial. For example, if a new price is added to a subscription a line item representing that price is also added. |

## Pending invoice items

### Invoice one-time charges added during an update 

When you use add_invoice_items to add only one-time charges during a mid-period subscription update or a subscription schedule phase transition, the behavior of proration_behavior=always_invoice depends on the billing mode. This difference only applies if no subscription item, price, or quantity change causes Stripe to create an invoice.

| **Classic** | **Flexible** |
| --- | --- |
| Stripe creates an update invoice that includes the added invoice items. | Stripe creates pending invoice items. Setting `proration_behavior=always_invoice` alone doesn’t create an immediate update invoice. The pending items can appear on a later eligible invoice, including the subscription’s renewal invoice. |

This difference doesn’t apply when another part of the update causes Stripe to create an invoice, when you create a subscription, or when a schedule phase transition occurs at renewal.

To invoice the added items for a subscription with flexible billing mode, wait for the next subscription invoice. To invoice them sooner, [create an invoice](https://docs.stripe.com/api/invoices/create.md) after the update or phase transition and set `subscription` to the subscription ID. The invoice includes all pending invoice items for that subscription, not only those added during the update or phase transition.

### Consistently include pending invoice items

Flexible billing mode includes all available pending invoice items in invoices generated by an update where `proration_behavior=always_invoice` and `payment_behavior` isn’t set to `pending_if_incomplete`.

| **Classic** | **Flexible** |
| --- | --- |
| Billing cycle anchor reset invoices include eligible pending items. All other update invoices generated with `proration_behavior=always_invoice` exclude pre-existing pending items when the update itself produces invoice items, such as prorations. | Flexible billing mode includes eligible pending invoice items when a subscription update generates an invoice, including updates with `proration_behavior=always_invoice` and billing cycle anchor resets.

Updates using `payment_behavior=pending_if_incomplete` are an exception because their invoices exclude pre-existing pending invoice items. These items remain pending for later invoicing. |

## Mixed intervals on the same subscription

Flexible billing mode lets you create [mixed interval subscriptions](https://docs.stripe.com/billing/subscriptions/mixed-interval.md), which can bill for multiple recurring prices with different intervals. That allows you to combine different pricing structures within a single subscription.

| **Classic** | **Flexible** |
| --- | --- |
| Not supported. All items in a subscription must have prices with the same interval and interval count. | Items on a [mixed interval subscription](https://docs.stripe.com/billing/subscriptions/mixed-interval.md) can have recurring prices with different intervals or interval counts. For example, a monthly price and an annual price can exist on the same subscription. |

## Subscription item limits

Flexible billing mode supports more subscription items than classic billing mode.

| **Classic** | **Flexible** |
| --- | --- |
| Supports up to 20 subscription items. | Supports up to 100 subscription items. |
