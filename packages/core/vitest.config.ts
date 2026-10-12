import { realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    // macOS hands out /var/folders/... while the files report /private/var/...: every temp
    // directory the tests make (`mkdtempSync(join(tmpdir(), ...))`) starts from the real path.
    env: { TMPDIR: realpathSync(tmpdir()) },
    // Real compiler programs, git repositories and worker threads: several tests take 3-6 s
    // on a CI runner, too close to vitest's 5 s default. Explicit per-test timeouts still win.
    testTimeout: 20_000,
  },
});
