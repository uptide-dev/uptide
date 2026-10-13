import { copyFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Options } from 'tsup';

/**
 * The CLI package's library entries, built from core's own entries so no engine code can reach
 * them. Each metafile lets the tests prove that (libs-export.test.ts).
 *
 * - `uptide/onboarding`: what the GitHub App imports to write the "Add Uptide" pull request.
 *   Pure (schema, types, validate, render, generateOnboarding from in-memory facts): no file
 *   system and no Node globals, so it loads under plain Node ESM, Vitest, Turbopack and in a
 *   browser bundle.
 * - `uptide/onboarding/node`: `loadUptideConfig` and `snapshotFromDisk`, which read the disk.
 * - `uptide/report`: the `uptide.run/v1` report the Uptide Action sends, its types and schema.
 *
 * `yaml` stays external, a dependency of the package: bundled, its CommonJS build calls
 * require("process"), which an ES module cannot. semver is pure and stays inlined.
 */
const src = (entry: string) => fileURLToPath(new URL(`../core/src/${entry}`, import.meta.url));
/** Types rolled up from core's own build of the entry (turbo builds core first). */
const types = (entry: string) =>
  fileURLToPath(import.meta.resolve(`@uptide/core/${entry}`)).replace(/\.js$/, '.d.ts');

const shared: Options = {
  format: ['esm'],
  platform: 'node',
  target: 'node20',
  clean: true,
  metafile: true,
  noExternal: [/^(?!yaml(?:\/|$))/],
  external: ['yaml'],
  minifyWhitespace: true,
  minifySyntax: true,
};

export default defineConfig([
  {
    ...shared,
    entry: { index: src('onboarding/index.ts'), node: src('onboarding/node.ts') },
    outDir: 'dist/onboarding',
    // The two entries share one copy of what both use.
    splitting: true,
    dts: {
      entry: { index: types('onboarding'), node: types('onboarding/node') },
      resolve: true,
    },
  },
  {
    ...shared,
    entry: { index: src('run-report/index.ts') },
    outDir: 'dist/report',
    splitting: false,
    dts: { entry: { index: types('run-report') }, resolve: true },
    // The JSON Schema as a file too: `uptide/report/schema.json`.
    async onSuccess() {
      copyFileSync(
        new URL('../../schema/uptide.run.v1.json', import.meta.url),
        new URL('dist/report/schema.json', import.meta.url),
      );
    },
  },
]);
