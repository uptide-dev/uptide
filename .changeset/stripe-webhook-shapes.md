---
'uptide': patch
---

Stripe pack: the subscription-period decisions now say that webhook payloads follow the API version set on each webhook endpoint, not the SDK pin, so a handler must read both the item-level and the subscription-level period until the endpoints move, and must not cast a missing timestamp into an Invalid Date.
