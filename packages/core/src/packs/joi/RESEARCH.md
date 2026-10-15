# joi 17 → 18: evidence and verification limits

Read date for every source below: **2026-10-14**. Scope: any 17.x release to any 18.x release,
pinned at **18.2.9** (published 2026-09-11, the latest at the read date). joi publishes no
GitHub release for 18.0.0; its release notes are an issue.

## Source ledger

- Release notes: [hapijs/joi#2926 "18.0.0 Release Notes"](https://github.com/hapijs/joi/issues/2926)
  (last edited 2025-08-09), the only breaking-changes item in milestone 18.0.0. 18.0.0 was
  published 2025-08-03.
- Tags: `v18.0.0` (`148e73a3edcbf037f018c9ca053ad272736782a2`), `v18.2.9`
  (`f2bf23419a03f80054a49758bb38c152159aa739`), `v17.7.0`
  (`77d7f925395f9946241d45b6e7d361998e3c2ca3`).
- Published packages (npm registry tarballs; nothing installed or executed): joi 17.6.0 to
  17.13.0 (every minor), 17.13.3, 17.13.8, 18.0.0 and 18.2.9: `lib/index.d.ts`,
  `lib/errors.js`, `lib/messages.js`, `lib/types/string.js`, `package.json`
  (`dependencies`, `engines`). @sideway/address 4.1.5 (`lib/tlds.js`, joi 17's TLD list) and
  @hapi/tlds 1.1.1 and 1.1.7 (the newest 1.x, which joi 18's `^1.1.1` resolves to).
- Companions' published manifests: @joi/date, joi-phone-number, joi-password-complexity,
  joi-to-swagger, joi-to-typescript, celebrate, nestjs-joi, @hookform/resolvers,
  joi-extract-type, @hapi/joi.
- No official migration guide or codemod exists beyond #2926.

## Classified changes

**M** = mechanical rule (rewrite), **A** = assisted (guide for the agent), **B** = behavior
note, **N** = no action.

| Change | Class and treatment | Source |
| --- | --- | --- |
| `new ValidationError(message, details, original)`: `details` typed `ValidationErrorItem[]`, was `any` | M `validation-error-details`: TS2345 naming `ValidationErrorItem[]`; `{}` becomes `[]`, anything else declines to the agent. **Introduced in 17.7.0, not 18.0.0**: it breaks only code written against 17.0–17.6. The runtime class is identical in 17.13.3 and 18.0.0 (`lib/errors.js`). | `index.d.ts` 17.6.0 vs 17.7.0 (bisected over every 17.x minor) |
| Node.js < 20 dropped (`engines: ">= 20"`), every @hapi dependency upgraded, `@sideway/*` moved to `@hapi/*` | B `node-20` (decision) | #2926, `package.json` 17.13.3 vs 18.0.0 |
| TLD list: @sideway/address 4.1.5 → @hapi/tlds 1.1.x. `string().email()`, `.domain()`, `.uri({ domain })` with default `tlds` reject avianca, bentley, comcast, dabur, dunlop, goo, guardian, kerrylogistics, lancaster, lipsy, natura, pramerica, redstone, shaw, wolterskluwer, xfinity; accept `merck` | B `email-tlds` (decision). At 18.0.0's floor, @hapi/tlds 1.1.1, 11 are removed (avianca, bentley, comcast, dabur, guardian, kerrylogistics, lancaster, lipsy, natura, shaw, xfinity) and nothing is added; 1.1.7, which a fresh install resolves, removes all 16 and adds `merck`. The edtech4good upgrade below documents the same 16. | `lib/tlds.js` of @sideway/address 4.1.5 vs @hapi/tlds 1.1.1 and 1.1.7 |
| `array().items()`, `alternatives()`/`alt()`, `try()`, `when()`/`conditional()` infer their value type from their arguments; `Joi.array<T>()` users move the type argument to `.items<T>()` | A, through the generic tier and `instructions` (no rule): no public upgrade hit it, so a rule would be unexercised; the compiler reports each site | #2926 "Typescript array() change", `index.d.ts` 17.13.3 vs 18.0.0 |
| `string().ip({ cidr })` validates the option itself: a bad value throws `options.cidr must be one of required, optional, forbidden` instead of `options.cidr must be a string` | N: an assertion on a programmer error, as #2926 says; not a validation message | #2926, `lib/types/string.js` |
| Validation error messages | N: `lib/messages.js` differs only in how it imports hoek; no message template changed, so tests asserting messages need nothing | `lib/messages.js` 17.13.3 vs 18.0.0 |
| `ValidationError` fields read through `any` (`err.details`, `err._original`) | N: `lib/errors.js` is unchanged 17.13.3 → 18.0.0, so no syntactic detection is needed (unlike zod's `formErrors`, uptide-dev/uptide#127) | `lib/errors.js` |
| Standard Schema support, `allowUnderscore` domain option, `uuid/guid({ wrapper })`, `isAsync()` | N: additive; `allowUnderscore` defaults to off | #2926, `index.d.ts` |

## Companions and peers

None moves with joi by documentation, so the pack declares no `companions`. Peer constraints
the engine reports as possible impact:

| Package | joi range | Effect |
| --- | --- | --- |
| joi-to-typescript 4.15.0 | peer `17.x` | **conflict**: rejects 18 |
| celebrate 16.0.0 | dependency `18.x.x` | bundles its own joi; an app on celebrate 15 keeps a 17 copy |
| @joi/date 3.0.0 | peer `>=18` | 2.x peers only on moment; 3.0.0 is the 18 line |
| nestjs-joi 1.12.0, @hookform/resolvers 5.9.1 | `^17 \|\| ^18` | none |
| joi-password-complexity 5.2.0, joi-to-swagger 6.2.0 | `>= 17` / `>=17.1.1` | none |
| joi-extract-type 15.0.8 | `@hapi/joi ~15` | unmaintained; not joi |
| @hapi/joi | last release 17.1.1 | a different package name: a leftover `@hapi/joi` import is a separate rename, not this upgrade |

## Independent ground truth

Merged public upgrades from 17.x to 18.x were found by searching merged pull request titles
(Dependabot, Renovate and hand-written), then reading each candidate's diff read-only through
the GitHub API. Two qualify and are used. Each parent was fetched shallow at its pinned commit
and installed from its own lockfile with lifecycle scripts off; nothing from a repository was
built, tested or run, and nothing was pushed, commented or opened on any of them.
Expectations were drafted with `pnpm packs:truth` (each repository's own TypeScript) and the
upgrade diff, reviewed by hand, and **committed before the pack had any rule** (`40c5062`).
They were not changed after scoring.

| Repository | Parent | Upgrade | Versions | Expected |
| --- | --- | --- | --- | --- |
| [edtech4good/edtech-lms-api](https://github.com/edtech4good/edtech-lms-api/pull/88) | `ce2281005fcf0c41a883779c778f3123a48bbeec` | `59fd4ca9222afd4ebbd4d0a28c4685cbbb1abcfd` | 17.6.0 → 18.2.9 | 108 `validation-error-details` sites in 21 files: each TS2345 is exactly a line the upgrade changed (`{}` → `[]`), and no changed line lacks one. The 109th `new ValidationError` is commented out and is not a site. |
| [senacor/azure-function-middleware](https://github.com/senacor/azure-function-middleware/commit/1f6a7fed060bcabcb0890565e8790bca03217a70) | `5c2da676e7327681dde70db6229edeebfa76b0f4` | `1f6a7fed060bcabcb0890565e8790bca03217a70` | 17.13.1 → 18.0.1 | none: negative control. 16 TypeScript files use joi; no new diagnostic at 18.0.1; the upgrade commit changes only `package.json` and `package-lock.json`. The PR's merge (#690) carries 27 other commits, among them a jest `toThrowError` → `toThrow` rename, which `packs:truth` drafted from the merge and is not a joi site; the joi commit itself is pinned instead. |

**Attribution check.** With joi **17.13.8** linked instead of 18.2.9, edtech4good's compiler
reports the same 108 TS2345: the break comes from 17.7.0's typing, inside the pack's `from`
range. Every 17.0–17.6 project that constructs `ValidationError` with `{}` meets it on the way
to 18; a project already on 17.7 or later never does.

### Screened out

- [Lushangtu123/E-commerce-website#53](https://github.com/Lushangtu123/E-commerce-website/pull/53)
  (17.13.8 → 18.2.9): moves helmet, express-rate-limit, ioredis, dotenv and bcryptjs in the same
  commit; its description says no affected joi API is used, and its joi diff is the manifest
  only. Usable as a second negative control, not needed.
- [pelias/whosonfirst#565](https://github.com/pelias/whosonfirst/pull/565): `@hapi/joi` 16 →
  `joi` 18; its `alternatives().try()` change is a 16 → 17 change.
- freeCodeCamp/freeCodeCamp#66011, oms-fyi/reviews#176, appsmithorg/appsmith#41891,
  hmcts/civil-citizen-ui#8185, hmcts/sscs-cor-frontend#1355, openedx/frontend-app-learning#2049,
  1024pix/pix (#17535, #17651, #17652), DEFRA/fcp-sfd-frontend-engine#95 and about ten more:
  manifest and lockfile only. Others matched the search but were already on 18
  (roXtra/processhub-sdk#3362 is 18.2.5 → 18.2.8).
- No merged public upgrade was found whose diff touches `array<T>`/`items<T>`,
  `alternatives`/`try`/`conditional` typing, `ip({ cidr })` or a TLD, despite targeted searches.
  The 2026-10-14 OSS scan in UPT-57 found joi in 3 of 53 repositories, two already on 18; joi
  has no entry in `packs/queue.json` (generated 2026-10-07).

## Measured pack test

`pnpm uptide pack test joi` (isolated `UPTIDE_GROUND_TRUTH_CACHE`), 2 public repositories:

| Rule / scoring group | Precision | Recall | TP | FP | FN |
| --- | ---: | ---: | ---: | ---: | ---: |
| validation-error-details | 100% | 100% | 108 | 0 | 0 |
| Overall sites | 100% | 100% | 108 | 0 | 0 |
| Behavior notes | n/a | n/a | 0 | 0 | 0 |
| Breaking sites | 100% | 100% | 108 | 0 | 0 |

**Rewrite at real sites.** Applied at the 108 positions edtech4good's own TypeScript reports
(the diagnostic start, where `check` places a compiler-only finding), the rule rewrites all
108, and the 21 files come out byte-identical to the repository's upgrade commit.

## What the evidence does and does not support

Under today's gate (≥2 public repositories, no breaking false positive, ≥1 breaking
prediction) and under the stricter one proposed in UPT-48 (≥5 expected breaking sites; a
rewrite with no real-world true positive runs assisted), this measures **verified**: the only
rewrite has 108 real true positives.

Read that narrowly:

- All 108 breaking sites are **one repository, one call shape, one change that shipped in
  17.7.0**. A project already on 17.7–17.13, which is most 17.x installs, gets no rule from
  this pack: its upgrade is the generic tier plus the two decisions.
- **18.0.0's own changes are unmeasured.** The generics rework has no public site and no
  rule; the TLD and Node notes are decisions, which `pack test` does not score.
- The negative control shows only that nothing fires on ordinary joi 17.13 code.

## What the engine cannot express

- **Version-scoped rules.** A rule cannot say "only from below 17.7.0". It does not need to:
  the TS2345 appears only where the installed code predates the 17.7 typing.
- **The TLD decision cannot name sites.** A `detect` for `email()`/`domain()` would fire on
  every email schema, and those sites would score as behavior false positives against ground
  truth that, correctly, has none, so the note is a decision on its summary alone.
