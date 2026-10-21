Jest is now on 30.5.2 and the upgrade is committed on `bench-base` as `83ff503`. Tests, type-check, lint and build all pass, and no code or config changes were needed.

**What changed**
- `jest` went from 29.7.0 to 30.5.2 and `@types/jest` from 29.5.14 to 30.0.0, both pinned to exact versions like the rest of the file.
- `ts-jest` 29.4.11 stays as it is, since it already accepts Jest 30.
- `jest.config.js` and the tests didn't need touching. The tests don't use any of the matcher aliases Jest 30 removed (`toBeCalled`, `toThrowError` and so on).

**Results**
- `npm test`: 2 suites, 34/34 tests pass.
- `npm run lint`: passes. In this repo "lint" is just `tsc --noEmit`, and that check skips `tests/` (the tsconfig excludes it). The test files are still type-checked by ts-jest when the tests run.
- `npm run build`: passes.

**Worth reviewing**
1. **`package-lock.json`**: most of the diff is here. Jest 30 replaces a large set of dependencies under the hood (51 added, 31 removed, 62 changed).
2. **Node version**: Jest 30 needs Node `^18.14.0 || ^20 || ^22 || >=24`. CI uses Node 20, which is fine. `package.json` still says `node >=18`, but that limit applies to people running the published package, not to development, so I left it alone.
3. **`npm audit` in CI will still fail.** The upgrade lowers the count from 44 vulnerabilities (35 high, 2 critical) to 31 (4 high, 2 critical), but CI fails on anything high or above. The ones left were already there before this change, for example in `@modelcontextprotocol/sdk`, `fast-uri`, `handlebars` and `browserslist`. Fixing them was outside this task; many can be fixed with `npm audit fix`, but `@modelcontextprotocol/sdk` needs `--force`, which means a breaking upgrade.
4. **CI only runs on pushes to `master`**, but the main branch is `main`. This isn't from this change, but pushes to `main` won't trigger CI (only pull requests will).
