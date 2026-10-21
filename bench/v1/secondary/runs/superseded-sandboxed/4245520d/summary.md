Jest is upgraded to 30.5.2 and committed on `bench-base` (`8b97924`). Type-check and build pass. The tests give the same result as before the upgrade: 836 pass, and the same 15 fail because of the sandbox, not because of Jest.

**What changed**
- **`package.json` and the lockfile:** `jest` is now `^30.5.2` and `@types/jest` is `^30.0.0`. `ts-jest` went from `^29.1.0` to `^29.4.15`, the first `ts-jest` release that officially supports Jest 30.
- **`src/__tests__/lint-windows-paths.test.ts`:** this was the only thing the upgrade broke. The whole suite crashed with "Maximum call stack size exceeded". Jest 30 treats `node:path` and `path` as the same module when mocking (the same goes for `path/posix` and `path/win32`). So the test's `node:path` mock replaced its `path` mock and then kept calling itself. I removed the four `node:` mocks, since mocking `path`, `path/posix` and `path/win32` now covers the `node:` forms too, and updated the comment above them. The suite already checks that the `node:` imports get the mocked module, and all 15 of its tests pass.

**Checks**
- `npm run lint` (which is `tsc --noEmit`, the type-check) and `npm run build` both pass.
- I searched for things Jest 30 removed (old matcher names like `toBeCalled` and `toThrowError`, `genMockFromModule`, the `--testPathPattern` flag) and found none. The test run showed no deprecation warnings.

**The 15 failures:** these same tests fail with Jest 29 in this sandbox, and none are caused by the upgrade:
- `guard-client.test.ts`: the sandbox won't let the test open a local socket (`listen EPERM`).
- `nanomind-real-daemon.test.ts`: it needs a running nanomind daemon, which isn't available here.
- `hma-scan.test.ts`: it expects no error output, but the sandbox adds a "failed to copy trust settings of system certificate" message to every command's error output.

They should pass in CI or on a normal machine, but I couldn't confirm that here.

**What to review**
1. The change to `lint-windows-paths.test.ts`. It depends on Jest 30 treating `node:` and bare names as the same module, so it won't work on Jest 29.
2. Running the three failing suites outside the sandbox, to confirm they pass.
3. `npm install` reported some `npm audit` warnings. I didn't look into them.
