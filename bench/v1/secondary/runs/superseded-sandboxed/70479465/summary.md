I upgraded jest to 30.5.2 and committed it on `bench-base` (6e4a324). The only changes are to dependencies; no source, test or config files needed edits. Type-check (`npm run lint`), the build and all 34 tests pass.

**What changed**
- `jest`: 29.7.0 → 30.5.2
- `@types/jest`: 29.5.14 → 30.0.0, the matching version for jest 30.
- `ts-jest` stays at 29.4.11, since it already officially supports jest 30.
- `package-lock.json` is regenerated (large diff, all from the dependency update).

**Things to review**
1. **Tests aren't covered by `npm run lint`.** `tsconfig.json` excludes `tests/`, so tsc never checks the test files. They are only type-checked by ts-jest when the tests run, and that passed. This was already true before the upgrade.
2. **Jest 30 breaking changes I checked:**
   - Jest 30 removed some old matcher aliases (e.g. `toBeCalled`, `toThrowError`). The tests don't use any of them.
   - `jest.restoreAllMocks()` now only resets mocks created with `jest.spyOn`. The tests only use `spyOn`, so nothing changes.
   - Jest 30 needs Node ^18.14 or newer. CI uses Node 20, but the `"node": ">=18"` in `package.json` would technically allow 18.0–18.13 for local development.
3. **Config:** `jest.config.js` (an ESM config using ts-jest's ESM preset) and the `--experimental-vm-modules` test script work unchanged.
4. **Security audit:** the dev-dependency audit count went down from 44 to 31 findings, mostly fewer high-severity ones. Production-dependency findings are unchanged at 8. I didn't touch them because they're outside this upgrade.
