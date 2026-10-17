import { realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    // Turbo runs both suites together; compiler programs and child processes need headroom.
    maxWorkers: 2,
    // macOS hands out /var/folders/... while the files report /private/var/...: every temp
    // directory the tests make (`mkdtempSync(join(tmpdir(), ...))`) starts from the real path.
    env: {
      TMPDIR: realpathSync(tmpdir()),
      // Offline tests must not select a live fixer from the developer's credentials.
      ANTHROPIC_API_KEY: '',
      OPENAI_API_KEY: '',
      GEMINI_API_KEY: '',
    },
    // Real compiler programs, git repositories and worker threads: several tests take 3-6 s
    // on a CI runner, too close to vitest's 5 s default. Explicit per-test timeouts still win.
    testTimeout: 20_000,
  },
});
