import { satisfies } from '../../fetch/range.js';
import type { BehaviorNote } from '../contract.js';
import type { PackContext } from '../types.js';
import { deepImportSites, untypedIconSites } from './detect.js';

/** Files of the declared inventory whose text matches, by repository-relative path. */
function evidence(context: PackContext, file: RegExp, text: RegExp): string[] {
  return (context.inventory ?? [])
    .filter((entry) => file.test(entry.file) && text.test(entry.text))
    .map((entry) => entry.file);
}

function named(files: string[]): string {
  const shown = files.slice(0, 5).map((file) => `\`${file}\``);
  return files.length > 5 ? `${shown.join(', ')} and ${files.length - 5} more` : shown.join(', ');
}

const TESTS = /(?:^|\/)(?:__tests__\/|[^/]+\.(?:test|spec)\.[cm]?[jt]sx?$)/;
const CONFIG = /(?:^|\/)next\.config\.[cm]?[jt]s$/;

export const lucideBehavior: BehaviorNote[] = [
  {
    id: 'untyped-icon-names',
    summary:
      'a removed icon reached by name where the compiler cannot see it (a cast, a deep import of its file, a name kept as data) is undefined at runtime in 1.x: React throws "Element type is invalid" where it renders',
    reported: ['finding'],
    severity: 'breaking',
    detect: (text) => untypedIconSites(text),
  },
  {
    id: 'deep-imports',
    summary:
      'imports of `lucide-react/dist/...` depend on its build output, not its API: 1.0.1 removed the UMD build and 1.9.0 renamed every ESM file to `.mjs`, so a path that names `.js` or `dist/umd` stops resolving and only the build shows it; import from "lucide-react" (tree-shaken by every current bundler) or keep an extensionless path the bundler resolves to `.mjs`',
    reported: ['finding', 'decision'],
    severity: 'deprecated',
    detect: (text) => deepImportSites(text),
    applies: (context) => {
      const files = evidence(context, CONFIG, /lucide-react\/dist\//);
      return files.length
        ? `${named(files)} maps lucide-react imports to \`lucide-react/dist/...\` paths (\`modularizeImports\`): 1.9.0 renamed every ESM file to \`.mjs\`. Remove the mapping (Next optimizes "lucide-react" imports itself) or confirm the build resolves the new files.`
        : false;
    },
  },
  {
    id: 'aria-hidden-default',
    summary:
      'icons without `aria-label`, `aria-labelledby`, `title` or children render `aria-hidden="true"` (since 0.489.0): an icon that is the only content of a button or link loses its accessible name, and tests that find icons by role (`getByRole("img")`) or snapshot their markup change',
    reported: ['decision', 'test-follow-up'],
    applies: (context) => {
      if (!satisfies(context.from, '<0.489.0')) return false;
      const files = evidence(
        context,
        TESTS,
        /ByRole\(\s*['"`]img|toMatch(?:Inline)?Snapshot|aria-hidden|lucide/,
      );
      const intro = `lucide-react ${context.from} predates 0.489.0, where icons became \`aria-hidden="true"\` unless they carry \`aria-label\`, \`aria-labelledby\`, \`title\` or children.`;
      return files.length
        ? `${intro} Tests that may depend on the old markup: ${named(files)}. Give icons that are the only content of a control an accessible name instead of changing the assertions.`
        : `${intro} Give icons that are the only content of a button or link an accessible name.`;
    },
  },
];
