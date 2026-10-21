Jest is now on 30.5.2 and committed as `641c0c0` on `bench-base`. Type-check and build pass. In the test suite, 836 of 851 tests pass; the other 15 also failed before the upgrade, and they fail here only because of the sandbox (details below).

**Changes**
- **`package.json` / lockfile:** `jest` is now `^30.5.2` and `@types/jest` is `^30.0.0`. `ts-jest` is now `^29.4.15`, which works with Jest 30, so it didn't need a new major version. `jest.config.js` needed no changes, and Jest prints no config or deprecation warnings.
- **`src/__tests__/lint-windows-paths.test.ts`:** Jest 30 treats `node:path` and `path` as the same module when mocking. So `jest.mock('node:path', () => jest.requireMock('path'))` replaced the `path` mock with itself, called itself endlessly and crashed with "Maximum call stack size exceeded". I removed the three `node:` mocks (`node:path`, `node:path/posix`, `node:path/win32`) and updated the comment to explain why. The mocks of `path`, `path/posix` and `path/win32` now cover the `node:` imports too. The test still checks each `node:` import route, and all 15 tests in the file pass.

**Checks**
- `npm run lint` (`tsc --noEmit`) and `npm run build` pass.
- `npx jest`: the same 15 tests failed before and after the upgrade, all for sandbox reasons:
  - `guard-client.test.ts`: the sandbox doesn't allow opening a local socket (`listen EPERM`).
  - `hma-scan.test.ts`: the sandbox blocks access to the system certificate store, so the scanner prints errors where the test expects no output.
  - `nanomind-real-daemon.test.ts`: there is no nanomind daemon here for it to connect to.

  These should pass on a normal machine or in CI, but I couldn't confirm that here.

**What to review**
1. The test-file change: check that you're happy for the `node:` imports to rely on Jest 30 mocking them together with the plain names.
2. The lockfile: about 50 packages were added and 30 removed. npm reports 28 vulnerabilities; I didn't look into them or compare against the count before the upgrade.
3. Jest 30 needs Node 18.14 or newer. If your CI or anyone using the repo runs an older Node, the tests won't run there.
