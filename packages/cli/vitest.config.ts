import { realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    // macOS hands out /var/folders/... while the files report /private/var/...: every temp
    // directory the tests make (`mkdtempSync(join(tmpdir(), ...))`) starts from the real path.
    env: { TMPDIR: realpathSync(tmpdir()) },
  },
});
