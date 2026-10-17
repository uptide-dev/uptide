import { join } from 'node:path';
import { packInventory } from './inventory.js';

/** Build output and vendored code: it mentions packages without being the repository's own source. */
const GENERATED = /(^|\/)(dist|build|out|coverage|vendor|\.turbo)\//;
/** A bundle that large is output, not source. */
const MAX_BYTES = 200_000;

/**
 * Workspace-relative `.js`/`.jsx`/`.mjs`/`.cjs` files whose text matches `needle`. The TypeScript
 * compile scope leaves these out (no `allowJs`, or outside the tsconfig `include`) and `detect`
 * reads only files that import the pack's package, so a script that reaches it another way
 * (`require('@sentry/core')`, a sibling package of the same release) is never analyzed (UPT-89).
 * Pass the result as `files` to the pack's base `runtimeFindings`.
 */
export function scriptsMentioning(
  input: {
    root: string;
    workspace: string;
    read: (file: string) => string | undefined;
  },
  needle: string | RegExp,
): string[] {
  const matches = (text: string) =>
    typeof needle === 'string' ? text.includes(needle) : needle.test(text);
  return packInventory(input.root, input.workspace, ['**/*.{js,jsx,mjs,cjs}']).filter((file) => {
    if (GENERATED.test(file)) return false;
    const text = input.read(join(input.workspace, file));
    return text !== undefined && text.length <= MAX_BYTES && matches(text);
  });
}
