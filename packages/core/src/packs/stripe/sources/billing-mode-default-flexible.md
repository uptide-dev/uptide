# Makes flexible billing mode the default for new subscriptions

## What’s new

Subscriptions you create through the API now default to [flexible billing mode](https://docs.stripe.com/billing/subscriptions/billing-mode.md). To use `classic`, set the `billing_mode.type` parameter to `classic`.

In the Stripe Dashboard, use **Billing Settings** to set an account-wide default billing mode for subscriptions you create with the **subscription editor** and payment links. You can display both billing modes and set the default to `flexible` or `classic`, or hide `classic` entirely. You can also configure billing mode behavior for subscriptions created through payment links and pricing tables.

## Why is this a breaking change?

[Flexible billing mode](https://docs.stripe.com/billing/subscriptions/billing-mode.md) changes subscription behavior and invoice calculations compared to `classic`. Review the [differences](https://docs.stripe.com/billing/subscriptions/billing-mode/compare.md).

It gives you accurate, predictable billing and additional features to manage subscriptions. This new default impacts these integrations:

- [Create a subscription](https://docs.stripe.com/api/subscriptions/create.md?api-version=2025-09-30.clover)
- [Create an invoice preview](https://docs.stripe.com/api/invoices/create_preview.md?api-version=2025-09-30.clover)
- [Create a subscription schedule](https://docs.stripe.com/api/subscription_schedules/create.md?api-version=2025-09-30.clover)
- [Create a quote](https://docs.stripe.com/api/quotes/create.md?api-version=2025-09-30.clover)
- Subscriptions created through the [Checkout Session API](https://docs.stripe.com/api/checkout/sessions/create.md?api-version=2025-09-30.clover)
- Subscriptions created through the [Payment Link API](https://docs.stripe.com/api/payment-link/create.md?api-version=2025-09-30.clover)

## Impact

For API users, the default billing mode depends on the request API version:

- If the request API version is [2025-09-30.clover](https://docs.stripe.com/changelog.md#2025-09-30.clover) or newer, the default is `flexible` billing mode.
- If the request API version is older than [2025-09-30.clover](https://docs.stripe.com/changelog.md#2025-09-30.clover), the default is `classic` billing mode.

For Dashboard users, the default billing mode is linked to the newly introduced Billing Mode Settings:

- New Stripe Billing users (those who’ve never created a subscription in live mode or test mode) only see `flexible` billing mode as the option.
- Existing users see both `flexible` and `classic` billing modes, with `classic` selected by default.
- You can configure the default Billing Mode Settings in your **Billing** settings.

## Upgrade

#### REST API

1. [View your current API version](https://docs.stripe.com/workbench/guides.md#view-api-versions) in Workbench.
2. If you use an SDK, upgrade to the corresponding SDK version for this API version.
   - If you don’t use an SDK, update your [API requests](https://docs.stripe.com/api-versions.md#how-versions-are-specified-in-requests) to include `Stripe-Version: 2025-09-30.clover`
3. Upgrade the API version used for [webhook endpoints](https://docs.stripe.com/webhooks/versioning.md).
4. [Test your integration](https://docs.stripe.com/testing.md) against the new version.
5. If you use Connect, [test your Connect integration](https://docs.stripe.com/connect/testing.md).

Learn more about [Stripe API upgrades](https://docs.stripe.com/upgrades.md).

#### Ruby

1. [View your current API version](https://docs.stripe.com/upgrades.md#view-your-api-version-and-the-latest-available-upgrade-in-workbench) in Workbench.
2. Upgrade your Ruby SDK to [v16.0.0](https://github.com/stripe/stripe-ruby/releases/tag/v16.0.0)
3. Upgrade the API version used for [webhook endpoints](https://docs.stripe.com/webhooks/versioning.md).
4. [Test your integration](https://docs.stripe.com/testing.md) against the new version.
5. If you use Connect, [test your Connect integration](https://docs.stripe.com/connect/testing.md).
6. In Workbench, [perform the upgrade](https://docs.stripe.com/upgrades.md#perform-the-upgrade). You can [roll back the version](https://docs.stripe.com/upgrades.md#roll-back-your-api-version) for 72 hours.

Learn more about [Stripe API upgrades](https://docs.stripe.com/upgrades.md).

#### Python

1. [View your current API version](https://docs.stripe.com/upgrades.md#view-your-api-version-and-the-latest-available-upgrade-in-workbench) in Workbench.
2. Upgrade your Python SDK to [v13.0.1](https://github.com/stripe/stripe-python/releases/tag/v13.0.1)
3. Upgrade the API version used for [webhook endpoints](https://docs.stripe.com/webhooks/versioning.md).
4. [Test your integration](https://docs.stripe.com/testing.md) against the new version.
5. If you use Connect, [test your Connect integration](https://docs.stripe.com/connect/testing.md).
6. In Workbench, [perform the upgrade](https://docs.stripe.com/upgrades.md#perform-the-upgrade). You can [roll back the version](https://docs.stripe.com/upgrades.md#roll-back-your-api-version) for 72 hours.

Learn more about [Stripe API upgrades](https://docs.stripe.com/upgrades.md).

#### PHP

1. [View your current API version](https://docs.stripe.com/upgrades.md#view-your-api-version-and-the-latest-available-upgrade-in-workbench) in Workbench.
2. Upgrade your PHP SDK to [v18.0.0](https://github.com/stripe/stripe-php/releases/tag/v18.0.0)
3. Upgrade the API version used for [webhook endpoints](https://docs.stripe.com/webhooks/versioning.md).
4. [Test your integration](https://docs.stripe.com/testing.md) against the new version.
5. If you use Connect, [test your Connect integration](https://docs.stripe.com/connect/testing.md).
6. In Workbench, [perform the upgrade](https://docs.stripe.com/upgrades.md#perform-the-upgrade). You can [roll back the version](https://docs.stripe.com/upgrades.md#roll-back-your-api-version) for 72 hours.

Learn more about [Stripe API upgrades](https://docs.stripe.com/upgrades.md).

#### Java

1. [View your current API version](https://docs.stripe.com/upgrades.md#view-your-api-version-and-the-latest-available-upgrade-in-workbench) in Workbench.
2. Upgrade your Java SDK to [v30.0.0](https://github.com/stripe/stripe-java/releases/tag/v30.0.0)
3. Upgrade the API version used for [webhook endpoints](https://docs.stripe.com/webhooks/versioning.md).
4. [Test your integration](https://docs.stripe.com/testing.md) against the new version.
5. If you use Connect, [test your Connect integration](https://docs.stripe.com/connect/testing.md).
6. In Workbench, [perform the upgrade](https://docs.stripe.com/upgrades.md#perform-the-upgrade). You can [roll back the version](https://docs.stripe.com/upgrades.md#roll-back-your-api-version) for 72 hours.

Learn more about [Stripe API upgrades](https://docs.stripe.com/upgrades.md).

#### Node.js

1. [View your current API version](https://docs.stripe.com/upgrades.md#view-your-api-version-and-the-latest-available-upgrade-in-workbench) in Workbench.
2. Upgrade your Node SDK to [v19.1.0](https://github.com/stripe/stripe-node/releases/tag/v19.1.0)
3. Upgrade the API version used for [webhook endpoints](https://docs.stripe.com/webhooks/versioning.md).
4. [Test your integration](https://docs.stripe.com/testing.md) against the new version.
5. If you use Connect, [test your Connect integration](https://docs.stripe.com/connect/testing.md).
6. In Workbench, [perform the upgrade](https://docs.stripe.com/upgrades.md#perform-the-upgrade). You can [roll back the version](https://docs.stripe.com/upgrades.md#roll-back-your-api-version) for 72 hours.

Learn more about [Stripe API upgrades](https://docs.stripe.com/upgrades.md).

#### Go

1. [View your current API version](https://docs.stripe.com/upgrades.md#view-your-api-version-and-the-latest-available-upgrade-in-workbench) in Workbench.
2. Upgrade your Go SDK to [v83.0.0](https://github.com/stripe/stripe-go/releases/tag/v83.0.0)
3. Upgrade the API version used for [webhook endpoints](https://docs.stripe.com/webhooks/versioning.md).
4. [Test your integration](https://docs.stripe.com/testing.md) against the new version.
5. If you use Connect, [test your Connect integration](https://docs.stripe.com/connect/testing.md).
6. In Workbench, [perform the upgrade](https://docs.stripe.com/upgrades.md#perform-the-upgrade). You can [roll back the version](https://docs.stripe.com/upgrades.md#roll-back-your-api-version) for 72 hours.

Learn more about [Stripe API upgrades](https://docs.stripe.com/upgrades.md).

#### .NET

1. [View your current API version](https://docs.stripe.com/upgrades.md#view-your-api-version-and-the-latest-available-upgrade-in-workbench) in Workbench.
2. Upgrade your .NET SDK to [v49.0.0](https://github.com/stripe/stripe-dotnet/releases/tag/v49.0.0)
3. Upgrade the API version used for [webhook endpoints](https://docs.stripe.com/webhooks/versioning.md).
4. [Test your integration](https://docs.stripe.com/testing.md) against the new version.
5. If you use Connect, [test your Connect integration](https://docs.stripe.com/connect/testing.md).
6. In Workbench, [perform the upgrade](https://docs.stripe.com/upgrades.md#perform-the-upgrade). You can [roll back the version](https://docs.stripe.com/upgrades.md#roll-back-your-api-version) for 72 hours.

Learn more about [Stripe API upgrades](https://docs.stripe.com/upgrades.md).

## Related changes

- [Removes iterations parameter for subscription schedules](https://docs.stripe.com/changelog/clover/2025-09-30/remove-iterations.md)
- [Promotion Codes now reference Coupons using a polymorphic field for promotions](https://docs.stripe.com/changelog/clover/2025-09-30/polymorphic-coupon.md)
- [Adds the Discount source property and removes the Discount coupon property](https://docs.stripe.com/changelog/clover/2025-09-30/add-discount-source-property.md)
- [Updates computation of subscription schedule phase end date to consider billing cycle anchor changes](https://docs.stripe.com/changelog/clover/2025-09-30/billing-cycle-anchor-resets-during-phase-computation.md)
- [Adds customer portal configuration trial behavior](https://docs.stripe.com/changelog/clover/2025-09-30/customer-portal-trial-behavior.md)
- [Adds the ability to itemize proration discount amounts](https://docs.stripe.com/changelog/clover/2025-09-30/itemize-proration-discount-amounts.md)
