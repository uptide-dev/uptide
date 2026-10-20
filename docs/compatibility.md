# Pack compatibility matrix

Every registered migration pack is listed below, including candidates. **From → to** gives
the installed and target version ranges from the pack metadata, with a target description
where semver alone cannot describe the upgrade. Single majors read as `4 → 5`, spans as
`4.x/5.x → 5.x/6.x`, and an open floor as `14+`. The README lists only verified packs;
this matrix also includes candidates. **Rules** counts all rules
in the pack, including assisted rules; behavior notes are separate and are not counted.
**Ground-truth repositories** lists distinct public repositories from `ground-truth.json`,
excluding local fixtures. Multiple upgrade cases from the same repository appear once.

**Status** is recorded by `uptide pack test --write` in `verification.json`. A **verified**
pack passed the [verification gate](packs.md); **candidate** packs ship but are not active
by default. The numbers measure breaking findings on the recorded ground truth, over every
repository `pack test` scores, the pack's synthetic fixture repositories included. **Precision**
is the share of breaking-severity findings that land on a ground-truth site, `n/a` when none was
predicted. **Found, any severity** and **Found as breaking** are shares of the same set, every
breaking site of those repositories: the first counts a site a finding landed on whatever its
severity (a deprecation, an unverified finding), the second only a site a breaking-severity
finding landed on; `—` for a record written before they were kept. **Breaking sites** counts the
public repositories only. These results describe that ground truth, not a guarantee that every
breaking change in another repository is covered.

The second table lists every rule with a rewrite, breaking or not. Its **precision** counts the
rule's real true positives in public repositories against its false positives wherever
`pack test` scored them. A rule below 80% (`RULE_PRECISION_WARNING`) is flagged. For now the
flag is a warning only: it changes no pack's status and no rule's run mode. Unexercised rules
already run as assisted ([verification gate](packs.md)).

<!-- packs:start -->
| Package | From → to | Rules | Precision | Found, any severity | Found as breaking | Breaking sites | Ground-truth repositories | Status |
| --- | --- | ---: | ---: | ---: | ---: | ---: | --- | --- |
| `ai` | 6 → 7 | 12 | 100% | 82% | 82% | 11 | vercel/chatbot, miurla/morphic | verified |
| `express` | 4 → 5 | 8 | 100% | 86% | 86% | 86 | netlify/cli, bcgov/tenant-management-system, amiantos/lurker, openhab/openhab-cloud | verified |
| `ioredis` | 5 → 6 | 2 | n/a | 0% | 0% | 2 | ferni-ai/voiceai, syzygyhack/open-foundry, simondietschi/dokunc, safe-global/safe-client-gateway, kazumadev619-dev/FishingConditionsApp | candidate |
| `joi` | 17 → 18 | 1 | n/a | — | — | — | edtech4good/edtech-lms-api, senacor/azure-function-middleware | candidate |
| `lucide-react` | 0 → 1 | 5 | 100% | 100% | 100% | 11 | tradeblocks-org/tradeblocks, spizeck/SFPCA, cubicsteak/keep | verified |
| `next` | 15 → 16 | 9 | 100% | 88% | 88% | 34 | sambecker/exif-photo-blog, stoczec/wortkarte, benshabbat/GamesForMyKids, HiroshiIgarash/koremina | verified |
| `openai` | 4 → 7 | 15 | 100% | — | — | 20 | zeikar/charivo, openai/openai-guardrails-js, wardby/wardby, csnyder256/ux-struggle-detector, grantsingleton/batch-ai, digitalchokro/askchokro, microsoft/prompty | candidate |
| `@prisma/client` | 6 → 7 | 12 | 100% | 100% | 100% | 29 | BearStudio/start-ui-web, jqlang/playground, openwallet-foundation-labs/ehr-wallet, bcgov/nr-permitconnect-navigator-service, basaltkit/basalt, AlexAgo83/cr-league, MarvinLeRouge/HexaRot | verified |
| `react` | 18 → 19 | 8 | 100% | 95% | 95% | 130 | excalidraw/excalidraw, tldraw/tldraw | verified |
| `react-router` | 6 → 7 | 13 | 100% | 89% | 78% | 18 | Arize-ai/phoenix, getlago/lago-front | verified |
| `redis` | 4.x/5.x → 5.x/6.x | 14 | 100% | 85% | 75% | 20 | deanmoses/tacocat-gallery-sam, swoofer/mcp-coordinator, UNN-Devotek/FCM-Fallout-Chat-Mod, tearingItUp786/blog | verified |
| `@sentry/browser` | 10 → 11 | 16 | 100% | 82% | 82% | 22 | Automancer-Ltd/automancer-site, sbomify/sbomify, MihaelaAghirculesei/Pokedex, Simple-With-Us/ContactLogo, getsentry/sentry-godot | verified |
| `@sentry/nextjs` | 10 → 11 | 24 | 100% | 100% | 100% | 8 | cohstats/coh3-stats, xdoubleu/tools.xdoubleu.com, maximunited/yomu | verified |
| `@sentry/react` | 10 → 11 | 16 | 88% | 72% | 72% | 29 | owine/youth-activity-scheduler, successible/cleanslate, Seklfreak/flimm, daler91/Hyrox-Companion, jey3dayo/ultra-rss-reader, jirikrucek/ricochet-app, louisclarencepeter/destinationparadise, poporonnet/kaniwriter, preijm/milk-me-not, CandeeGenerations/central-flock, DougZeThug/717rec, CandeeGenerations/attendance-public, cucumber/cucumber-reports, Simple-With-Us/BotFleet | candidate |
| `stripe` | 12+ → latest, API version pinning | 6 | 100% | 92% | 92% | 21 | unkeyed/unkey, nextjs/saas-starter, starl3xx/wallet-to-social, AtlasDevHQ/atlas | verified |
| `typescript` | 5 → 6 | 12 | 100% | 99% | 99% | 1399 | m-lyon/recipe, robrechtme/recipes, JosephMaynard/dependency-radar, CroffZ/github-release-notifier, SignalK/signalk-derived-data, shogo82148/typescript-action, Borewit/music-metadata | verified |
| `vitest` | 4 → 5 | 6 | 100% | 97% | 97% | 32 | votingworks/vxsuite, vitorvasc/opentelemetry-ecosystem-explorer | verified |
| `zod` | 3 → 4 | 11 | 100% | 87% | 48% | 224 | ugurkocde/AwesomeIntune, howardyang2009/PATH, band-ai/band-sdk-typescript, vzdc-artcc/website, CANShift/canshift-core, consetto/calmcp | verified |

| Package | Rewrite rule | Precision | Real true positives | False positives | Note |
| --- | --- | ---: | ---: | ---: | --- |
| `ai` | `full-stream` | 100% | 12 | 0 |  |
| `ai` | `instructions` | 100% | 12 | 0 |  |
| `ai` | `is-step-count` | 100% | 9 | 0 |  |
| `ai` | `on-end` | 100% | 7 | 0 |  |
| `ai` | `on-step-end` | 100% | 2 | 0 |  |
| `ai` | `removed-experimental-option` | 100% | 1 | 0 |  |
| `ai` | `telemetry` | 100% | 3 | 0 |  |
| `ai` | `total-usage` | 100% | 2 | 0 |  |
| `joi` | `validation-error-details` | 100% | 108 | 0 |  |
| `lucide-react` | `renamed-icons` | n/a | 0 | 0 | unexercised: runs assisted |
| `next` | `lint-removal` | 100% | 1 | 0 |  |
| `next` | `middleware-proxy` | 50% | 1 | 1 | below 80% on 2 sites, too few to judge: runs mechanical |
| `next` | `stable-cache-exports` | 100% | 3 | 0 |  |
| `openai` | `beta-chat` | n/a | 0 | 0 | unexercised: runs assisted |
| `openai` | `core-paths` | n/a | 0 | 0 | unexercised: runs assisted |
| `openai` | `delete-method` | n/a | 0 | 0 | unexercised: runs assisted |
| `openai` | `named-path-params` | n/a | 0 | 0 | unexercised: runs assisted |
| `openai` | `removed-modules` | n/a | 0 | 0 | unexercised: runs assisted |
| `openai` | `request-options` | n/a | 0 | 0 | unexercised: runs assisted |
| `openai` | `runner-renames` | n/a | 0 | 0 | unexercised: runs assisted |
| `@prisma/client` | `cli-skip-flags` | 100% | 1 | 0 |  |
| `react` | `mutable-ref-object` | 100% | 2 | 0 |  |
| `react` | `ref-callback-return` | 100% | 1 | 0 |  |
| `react` | `use-ref-argument` | 100% | 5 | 0 |  |
| `react-router` | `dom-imports` | 8% | 29 | 336 | below 80%: runs assisted |
| `redis` | `keep-alive` | n/a | 0 | 0 | unexercised: runs assisted |
| `redis` | `quit-disconnect` | n/a | 0 | 0 | unexercised: runs assisted |
| `redis` | `renamed-exports` | 100% | 2 | 0 |  |
| `redis` | `scan-iterators` | n/a | 0 | 0 | unexercised: runs assisted |
| `redis` | `unstable-resp3` | n/a | 0 | 0 | unexercised: runs assisted |
| `@sentry/browser` | `enable-logs` | 100% | 2 | 0 |  |
| `@sentry/browser` | `enable-metrics` | n/a | 0 | 0 | unexercised: runs assisted |
| `@sentry/browser` | `integration-names` | n/a | 0 | 0 | unexercised: runs assisted |
| `@sentry/browser` | `renamed-exports` | 100% | 7 | 0 |  |
| `@sentry/browser` | `streamed-span-wrapper` | n/a | 0 | 0 | unexercised: runs assisted |
| `@sentry/nextjs` | `build-options` | 100% | 1 | 0 |  |
| `@sentry/nextjs` | `enable-logs` | n/a | 0 | 0 | unexercised: runs assisted |
| `@sentry/nextjs` | `enable-metrics` | n/a | 0 | 0 | unexercised: runs assisted |
| `@sentry/nextjs` | `http-integration-options` | n/a | 0 | 0 | unexercised: runs assisted |
| `@sentry/nextjs` | `integration-names` | n/a | 0 | 0 | unexercised: runs assisted |
| `@sentry/nextjs` | `renamed-exports` | n/a | 0 | 0 | unexercised: runs assisted |
| `@sentry/nextjs` | `streamed-span-wrapper` | n/a | 0 | 0 | unexercised: runs assisted |
| `@sentry/nextjs` | `with-sentry-config-import` | 100% | 3 | 0 |  |
| `@sentry/react` | `enable-logs` | 100% | 4 | 0 |  |
| `@sentry/react` | `enable-metrics` | n/a | 0 | 0 | unexercised: runs assisted |
| `@sentry/react` | `integration-names` | 0% | 0 | 1 | unexercised: runs assisted |
| `@sentry/react` | `renamed-exports` | n/a | 0 | 0 | unexercised: runs assisted |
| `@sentry/react` | `streamed-span-wrapper` | n/a | 0 | 0 | unexercised: runs assisted |
| `stripe` | `api-version-unpinned` | 100% | 5 | 0 |  |
| `stripe` | `fixture-cast` | n/a | 0 | 0 | unexercised: runs assisted |
| `stripe` | `request-options` | n/a | 0 | 0 | unexercised: runs assisted |
| `typescript` | `downlevel-iteration` | n/a | 0 | 0 | unexercised: runs assisted |
| `typescript` | `import-assertions` | n/a | 0 | 0 | unexercised: runs assisted |
| `typescript` | `module-keyword` | n/a | 0 | 0 | unexercised: runs assisted |
| `vitest` | `removed-entrypoints` | n/a | 0 | 0 | unexercised: runs assisted |
| `zod` | `error-issues` | 100% | 51 | 0 |  |
| `zod` | `error-members` | n/a | 0 | 0 | unexercised: runs assisted |
| `zod` | `error-params` | 100% | 15 | 0 |  |
| `zod` | `record-key` | 100% | 2 | 0 |  |
| `zod` | `string-format` | 100% | 22 | 0 |  |
<!-- packs:end -->

Dependencies without an active pack still receive [generic analysis](concepts.md).

This table and the README table are generated by [scripts/docs-packs.ts](../scripts/docs-packs.ts)
from the [pack registry](../packages/core/src/packs/registry.ts), pack metadata, rules,
verification records and ground truth. Do not edit the rows by hand. After changing those
sources, run `pnpm docs:packs` and commit the generated tables. `pnpm docs:packs --check`
fails if either table is stale; the [CI docs job](../.github/workflows/ci.yml) runs it on
every pull request and push to main.
