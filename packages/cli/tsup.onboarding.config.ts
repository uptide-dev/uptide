import { fileURLToPath } from 'node:url';
import { defineConfig } from 'tsup';

// `uptide/onboarding`: what the GitHub App imports to write the "Add Uptide" pull request.
// Built from core's onboarding entry alone, into one self-contained file: yaml and semver are
// inlined (the package has no runtime dependencies), and no engine code can reach it.
// Its metafile lets the tests prove that (onboarding-export.test.ts).
export default defineConfig({
  entry: { index: fileURLToPath(new URL('../core/src/onboarding/index.ts', import.meta.url)) },
  outDir: 'dist/onboarding',
  format: ['esm'],
  platform: 'node',
  target: 'node20',
  splitting: false,
  clean: true,
  metafile: true,
  noExternal: [/.*/],
  minifyWhitespace: true,
  minifySyntax: true,
  // Types rolled up from core's own build of the entry (turbo builds core first).
  dts: {
    entry: {
      index: fileURLToPath(import.meta.resolve('@uptide/core/onboarding')).replace(
        /\.js$/,
        '.d.ts',
      ),
    },
    resolve: true,
  },
});
