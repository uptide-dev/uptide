---
"uptide": patch
---

A package that does not move no longer drags another one through its pins: `fix typescript` on guardian/support-dotcom-components moved `@guardian/ophan-tracker-js` 2.8.3 → 3.1.0 because `@guardian/libs` 33.0.0, which stayed, pins it. A pin the same manifest also declares as a peer the install satisfies moves nothing either, and a pin reason now names the manifest field and the installed version.
