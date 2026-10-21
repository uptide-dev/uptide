vitest and `@vitest/coverage-v8` are now on 5.0.5, committed on `bench-base` as `95e77bd`. Type-check, lint, `prettier --check` and the full unit suite with coverage all pass (1966 tests). I didn't run the Playwright e2e tests (`npm run test:e2e`), which don't use vitest.

**What changed**
- **Dependencies:** both packages moved together and are still pinned exactly. The coverage plugin requires the exact same vitest version. `vite` 8 and Node ≥22.13 still meet vitest 5's requirements.
- **Reporter fixture:** `tests/unit/reporter-contract.test.ts` fails on purpose when vitest's version changes and no fixture for the new version is committed. So I replaced `vitest-4.1.10.json` with `vitest-5.0.5.json`, made by running vitest 5.0.5 on a rebuilt copy of the original sample spec: same tests, same failures. Machine paths are rewritten to `/repo`, following the fixture README. The three tests that read the fixture now point at the new file, and I added a vitest row to `tests/fixtures/reporters/README.md`.
- **No config or source changes were needed.** `vitest.config.ts` (reporters, `outputFile`, coverage settings) works unchanged on 5.x.

**Worth reviewing**
1. **The new fixture file.** Every field the vitest report parser (`contracts/reporters/vitest.ts`) reads is unchanged. The only differences:
   - Each test result now has an extra `benchmarks: []` field, which the parser ignores.
   - Stack traces now point into `vitest/dist/chunks/run.*.js` instead of `@vitest/runner/dist/...`.
   - One column number differs (`19:10` instead of `19:11`), because the original sample spec wasn't committed and I had to rebuild it. Nothing checks that column.
2. **Coverage and warnings are the same as before.** I ran 4.1.10 in a separate checkout to compare. Coverage is identical (95.78% statements, 85.43% branches), still above the floors in `vitest.config.ts`. The `MaxListenersExceededWarning` from `scripts/dev.ts` shows up on both versions, so the upgrade didn't cause it.
3. **New suggestion in the output.** vitest 5 now prints a hint at the end of each run that `isolate: false` would be faster. I left it alone because switching it off changes how test files are kept apart from each other.
