import { defineConfig } from 'tsup';
import { uptideVersionInfo, version } from './src/version.js';

const metadata = uptideVersionInfo();

export default defineConfig({
  define: {
    __UPTIDE_BUILD_VERSION__: JSON.stringify(version),
    __UPTIDE_BUILD_COMMIT__: JSON.stringify(metadata.uptideCommit),
    __UPTIDE_BUILD_DIRTY__: JSON.stringify(metadata.uptideDirty),
  },
  entry: {
    index: 'src/index.ts',
    worker: 'src/check/worker.ts',
    'list-worker': 'src/list/list-worker.ts',
    // What the GitHub App imports: the generator and uptide.yml, without the engine.
    onboarding: 'src/onboarding/index.ts',
    'onboarding-node': 'src/onboarding/node.ts',
    // What `uptide/report` is built from: the Action's run report, without the engine.
    'run-report': 'src/run-report/index.ts',
  },
  format: ['esm'],
  // The Uptide Action builds the engine at its pinned commit and needs no declarations.
  dts: process.env.UPTIDE_BUILD_NO_DTS !== '1',
  sourcemap: true,
  clean: true,
  target: 'node20',
  // `--agent sdk` loads it at run time, when installed: never inlined (not open source).
  external: ['@anthropic-ai/claude-agent-sdk'],
});
