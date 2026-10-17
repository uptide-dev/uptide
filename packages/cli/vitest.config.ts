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
      // Hints print `npx uptide` however the runner was launched (installed bin, npx, pnpm).
      npm_command: 'exec',
      // Offline tests must not select a live fixer from the developer's credentials.
      ANTHROPIC_API_KEY: '',
      OPENAI_API_KEY: '',
      GEMINI_API_KEY: '',
    },
  },
});
