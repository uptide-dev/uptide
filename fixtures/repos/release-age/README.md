# Release-age fixtures

Invented packages (`widget`, `gadget`, `@acme/tool`) and one release-age policy per package
manager. Registry responses, publish dates included, are mocked by
`packages/core/src/fetch/release-age.test.ts`.

| Fixture | Policy | Exempt |
| --- | --- | --- |
| `npm` | `min-release-age=7` in `.npmrc` (days) | nothing: npm has no exclude list |
| `pnpm` | `minimumReleaseAge: 10080` in `pnpm-workspace.yaml` (minutes) | `@acme/*`, `gadget@5.0.0` |
| `yarn` | `npmMinimalAgeGate: 3d` in `.yarnrc.yml` | `gadget` |
| `none` | none; the tests set uptide.yml's `min-release-age` fallback | |
