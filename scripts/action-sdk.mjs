// The Uptide Action's default executor is `--agent sdk` (action/run.ts passes it unless
// uptide.yml sets `executor: patch`). The Agent SDK and the Claude Code binary for this runner
// come from the frozen install in action-setup.sh: the SDK is a dependency of the CLI package,
// the binary an optional dependency per platform. Prove both are there before any run starts,
// rather than failing in the middle of a fix. Run from the Action's directory.
import { createRequire } from 'node:module';
import { join } from 'node:path';

const fromCli = createRequire(join(process.cwd(), 'packages/cli/package.json'));
let sdk;
try {
  sdk = fromCli.resolve('@anthropic-ai/claude-agent-sdk');
} catch {
  console.log(
    '::error title=Uptide::The Agent SDK is not installed with the engine; --agent sdk cannot run.',
  );
  process.exit(1);
}
const base = `@anthropic-ai/claude-agent-sdk-${process.platform}-${process.arch}`;
const binary = process.platform === 'win32' ? 'claude.exe' : 'claude';
const found = [base, `${base}-musl`]
  .map((name) => {
    try {
      return createRequire(sdk).resolve(`${name}/${binary}`);
    } catch {
      return undefined;
    }
  })
  .find(Boolean);
if (!found) {
  console.log(
    `::error title=Uptide::The Claude Code binary for ${process.platform}-${process.arch} is not installed; --agent sdk cannot run on this runner.`,
  );
  process.exit(1);
}
console.log(`Agent SDK ready: ${found.split('node_modules/').at(-1)}`);
