import { fileURLToPath } from 'node:url';
import { defineConfig } from 'tsup';

// `uptide/onboarding`: what the GitHub App imports to write the "Add Uptide" pull request.
// Two entries, built from core's onboarding alone so no engine code can reach them:
// - `uptide/onboarding`: pure (schema, types, validate, render, generateOnboarding from
//   in-memory facts). No file system and no Node globals: it loads under plain Node ESM,
//   Vitest, Turbopack and in a browser bundle.
// - `uptide/onboarding/node`: `loadUptideConfig` and `snapshotFromDisk`, which read the disk.
// `yaml` stays external, a dependency of the package: bundled, its CommonJS build calls
// require("process"), which an ES module cannot. semver is pure and stays inlined.
// The metafile lets the tests prove all of it (onboarding-export.test.ts).
const core = (entry: string) =>
  fileURLToPath(import.meta.resolve(`@uptide/core/${entry}`)).replace(/\.js$/, '.d.ts');
export default defineConfig({
  entry: {
    index: fileURLToPath(new URL('../core/src/onboarding/index.ts', import.meta.url)),
    node: fileURLToPath(new URL('../core/src/onboarding/node.ts', import.meta.url)),
  },
  outDir: 'dist/onboarding',
  format: ['esm'],
  platform: 'node',
  target: 'node20',
  // The two entries share one copy of what both use.
  splitting: true,
  clean: true,
  metafile: true,
  noExternal: [/^(?!yaml(?:\/|$))/],
  external: ['yaml'],
  minifyWhitespace: true,
  minifySyntax: true,
  // Types rolled up from core's own build of the entries (turbo builds core first).
  dts: {
    entry: { index: core('onboarding'), node: core('onboarding/node') },
    resolve: true,
  },
});
