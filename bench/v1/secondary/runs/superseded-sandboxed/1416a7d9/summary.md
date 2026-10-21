I upgraded Vitest and `@vitest/coverage-v8` from 4.1.10 to 5.0.5, and committed it as `a7e567e` on `bench-base`. Type-check, lint, the unit tests (1966 of 1966), coverage and the format check all pass. The browser (e2e) tests and the changelog check did not run in this sandbox.

**What changed**
- **`package.json` and the lockfile:** both packages are pinned exactly at 5.0.5. No source or config changes were needed; `vitest.config.ts` works as it is on v5.
- **Reporter fixture:** the one test that failed after the bump was `tests/unit/reporter-contract.test.ts`, which requires a saved Vitest report named after the pinned version. I replaced `vitest-4.1.10.json` with `vitest-5.0.5.json`. It is real output from a 5.0.5 run against a small sample test file rebuilt to match the old one: same tests, titles and pass/fail/skip mix. As before, machine paths are rewritten to `/repo`. I updated the three tests that load the fixture and added a row for it to the fixtures README.

**What to review**
1. **The new fixture.** Vitest 5 adds an empty `benchmarks` list to each test result, and its stack frames now point into `vitest/dist/chunks/...` instead of `@vitest/runner`. The normaliser accepts extra fields, so its output is the same. One stack column differs by one character from the old fixture (`19:12` vs `19:11`) because the sample file is a reconstruction; nothing checks it.
2. **Coverage still clears its floors:** 95.78% statements, 85.43% branches, 95.91% functions, 97.02% lines.

**Not verified here**
- **`npm run test:e2e` and `npm run changelog:check`** both stop immediately: the sandbox blocks the `tsx` tool from opening its local pipe (`listen EPERM`). Neither involves Vitest, but both should be run in CI or on your machine.

The unit run also prints a "MaxListenersExceededWarning". It comes from the repo's own tests of `scripts/dev.ts` adding signal handlers again and again, not from Vitest.
