import { definePack } from '../contract.js';
import {
  assertToWith,
  moduleToNamespace,
  optionSites,
  removeDownlevelIteration,
  rootDirSites,
  unsetDefaults,
} from './detect.js';

/**
 * typescript >=5 <6 → >=6 <7. The upgraded package is the compiler: what breaks is the
 * repository's tsconfig (options 6.0 deprecates, errors until `ignoreDeprecations` is set) and
 * code the new compiler rejects, much of it because a default changed. Code diagnostics come
 * from `check`'s compile of the whole project with the target's own compiler
 * (adapters/typescript/compile.ts, compileCompilerUpgrade); the tsconfig sites are this pack's,
 * found in every tsconfig*.json of the workspace where the option is set. Sources read
 * 2026-10-14; RESEARCH.md has the range decision and the evidence for each rule.
 */
const NOTES = 'https://www.typescriptlang.org/docs/handbook/release-notes/typescript-6-0.html';

const deprecated = (option: string, replacement: string): string =>
  `TypeScript 6.0 deprecates ${option}: \`tsc\` fails on it unless \`"ignoreDeprecations": "6.0"\` is set, and 7.0 removes it. ${replacement} Never add \`ignoreDeprecations\` to make the compile pass: that is a decision for the owner, not a migration.`;

export const typescriptPack = definePack({
  meta: {
    package: 'typescript',
    from: '>=5 <6',
    to: '>=6 <7',
    sources: [
      { title: 'TypeScript 6.0 release notes (read 2026-10-14)', url: NOTES },
      {
        title: 'Announcing TypeScript 6.0, 2026-03-23 (read 2026-10-14)',
        url: 'https://devblogs.microsoft.com/typescript/announcing-typescript-6-0/',
      },
    ],
    maintainer: 'uptide-dev',
  },
  inventory: ['{tsconfig*.json,**/tsconfig*.json}'],
  requiresBuild: true,
  rules: [
    {
      id: 'base-url',
      summary: 'baseUrl is deprecated and no longer a lookup root for bare imports',
      severity: 'breaking',
      kinds: [],
      symbols: /$^/,
      detect: optionSites('baseUrl'),
      guide: deprecated(
        '`baseUrl`',
        'Remove it and write its directory into each `paths` entry (`"@app/*": ["./src/app/*"]` where it was `baseUrl: "./src"` and `"@app/*": ["app/*"]`). If bare imports resolved through it (`import x from "components/x"`), add `"*": ["./src/*"]` to `paths` only when the compiler reports them unresolved. A bundler or framework that reads `baseUrl` itself (Next.js, vite-tsconfig-paths) resolves the same imports at runtime: keep both in step and say so.',
      ),
    },
    {
      id: 'downlevel-iteration',
      summary: 'downlevelIteration is deprecated; it only ever affected ES5 output',
      severity: 'breaking',
      kinds: [],
      symbols: /$^/,
      detect: optionSites('downlevelIteration'),
      rewrite: removeDownlevelIteration,
      guide: deprecated(
        '`downlevelIteration`',
        'Remove the option. It changed only ES5 output, so with a target of ES2015 or later removing it changes nothing.',
      ),
    },
    {
      id: 'module-resolution-node10',
      summary: 'moduleResolution node (node10) is deprecated: use bundler or nodenext',
      severity: 'breaking',
      kinds: [],
      symbols: /$^/,
      detect: optionSites('moduleResolution', ['node', 'node10']),
      guide: deprecated(
        '`moduleResolution: "node"` (`node10`)',
        'Use `"bundler"` when a bundler (Vite, webpack, Next.js, esbuild) or Bun loads the code, `"nodenext"` (with `"module": "nodenext"`) when Node.js runs the output directly. The choice changes how `exports` maps and extensions resolve: name it in the pull request. Change `module` only when the chosen resolution requires it.',
      ),
    },
    {
      id: 'module-resolution-classic',
      summary: 'moduleResolution classic is removed: use bundler or nodenext',
      severity: 'breaking',
      kinds: [],
      symbols: /$^/,
      detect: optionSites('moduleResolution', ['classic']),
      guide:
        'TypeScript 6.0 removes `moduleResolution: "classic"`. Use `"bundler"` for bundled code or `"nodenext"` for code Node.js runs, and say which and why.',
    },
    {
      id: 'target-es5',
      summary: 'target ES5 (and ES3) is deprecated: the lowest target is ES2015',
      severity: 'breaking',
      kinds: [],
      symbols: /$^/,
      detect: optionSites('target', ['es3', 'es5']),
      guide: deprecated(
        '`target: "es5"`',
        'Raising the target changes the emitted JavaScript (classes, arrow functions and iteration stay native): a decision for the owner when the output runs in old browsers. With `noEmit` (a bundler emits) `target` only selects the default `lib`, and `"es2015"` or later is safe. Otherwise name the browsers the output must run in, or leave ES5 output to the bundler.',
      ),
    },
    {
      id: 'module-format-removed',
      summary: 'module amd, umd, system and none are deprecated: emit ES modules or CommonJS',
      severity: 'breaking',
      kinds: [],
      symbols: /$^/,
      detect: optionSites('module', ['amd', 'umd', 'system', 'systemjs', 'none']),
      guide: deprecated(
        '`module` values `amd`, `umd`, `system` and `none`',
        'Emit ES modules (`"esnext"`, `"preserve"`) or CommonJS and let a bundler produce the AMD, UMD or SystemJS output. This changes what consumers load: a decision for the owner.',
      ),
    },
    {
      id: 'out-file',
      summary: 'outFile is deprecated: concatenate with a bundler',
      severity: 'breaking',
      kinds: [],
      symbols: /$^/,
      detect: optionSites('outFile'),
      guide: deprecated(
        '`outFile`',
        'A bundler (esbuild, Rollup, webpack, Vite) produces the single file instead. This changes the build: a decision for the owner.',
      ),
    },
    {
      id: 'interop-false',
      summary: 'esModuleInterop and allowSyntheticDefaultImports can no longer be false',
      severity: 'breaking',
      kinds: [],
      symbols: /$^/,
      detect: (text, file) => [
        ...optionSites('esModuleInterop', [false])(text, file),
        ...optionSites('allowSyntheticDefaultImports', [false])(text, file),
      ],
      guide: deprecated(
        '`esModuleInterop: false` and `allowSyntheticDefaultImports: false`',
        'Remove the `false` setting: the safer interop is always on. Emitted CommonJS then goes through the interop helpers, and a namespace import that is called or constructed (`import * as express from "express"; express()`) becomes a default import (`import express from "express"`), at the sites the compiler reports.',
      ),
    },
    {
      id: 'always-strict-false',
      summary: 'alwaysStrict false is deprecated: all code is strict mode',
      severity: 'breaking',
      kinds: [],
      symbols: /$^/,
      detect: optionSites('alwaysStrict', [false]),
      guide: deprecated(
        '`alwaysStrict: false`',
        'Remove it. Emitted scripts gain "use strict": reserved words (`await`, `static`, `private`, `public`) cannot be identifiers and sloppy-mode `this` no longer applies. Fix the sites the compiler reports; name any non-module script whose runtime behavior may change.',
      ),
    },
    {
      id: 'root-dir',
      summary:
        'rootDir now defaults to the tsconfig directory: set it where outDir relied on inference',
      severity: 'breaking',
      kinds: [],
      symbols: /$^/,
      detect: rootDirSites,
      guide:
        'TypeScript 6.0 defaults `rootDir` to the directory of the tsconfig, where 5.x inferred the common directory of the inputs; a project emitting from `src/` to `outDir` would write `dist/src/...`, and `tsc` stops with TS5011. Set `"rootDir"` to the directory 5.x inferred (`"./src"` for `include: ["src"]`), so the output layout stays the same. When `include` reaches outside the tsconfig directory, set it to the common parent (`"../src"`).',
    },
    {
      id: 'module-keyword',
      summary: 'a namespace declared with `module` is an error: write `namespace`',
      severity: 'breaking',
      kinds: ['type'],
      symbols: /^TS1540$/,
      message: /should not be declared using the 'module' keyword/,
      rewrite: moduleToNamespace,
      guide:
        '`module Foo { }` declares a namespace and is an error in TypeScript 6.0: write `namespace Foo { }`. `declare module "name" { }` (a quoted name) is an ambient module and is unchanged.',
    },
    {
      id: 'import-assertions',
      summary: 'import assertions (`assert { type }`) are errors: write `with { type }`',
      severity: 'breaking',
      kinds: ['type'],
      symbols: /^TS2880$/,
      message: /Use 'with' instead of 'assert'/,
      rewrite: assertToWith,
      guide:
        'Import assertions were replaced by import attributes: `import data from "./data.json" with { type: "json" }`, and `import("./data.json", { with: { type: "json" } })`. Node.js 18.20, 20.10 and later accept `with`; Node.js 22 rejects `assert`.',
    },
  ],
  behavior: [
    {
      id: 'changed-defaults',
      summary:
        'TypeScript 6.0 changed defaults a tsconfig may rely on: strict is on, types is [], noUncheckedSideEffectImports is on, rootDir is the tsconfig directory, module is esnext and target is the current ES year. Each option left unset either keeps its new value (the code is fixed where the compiler reports it) or is pinned to its 5.x value in the tsconfig; say which, per option.',
      reported: ['decision'],
      applies: ({ inventory }) => {
        const lines = unsetDefaults(inventory ?? []);
        return lines.length > 0
          ? `TypeScript 6.0 changed defaults these tsconfig files leave unset; each keeps its new value or is pinned to its 5.x value, say which: ${lines.join(' · ')}`
          : false;
      },
    },
  ],
  instructions: [
    'TypeScript 6.0 is a compiler upgrade: the errors are the new compiler judging the same code, and each one is fixed in the code or the tsconfig it names.',
    'Never make the compile pass with `any`, `as any`, `@ts-ignore`, `@ts-expect-error`, `@ts-nocheck`, `ignoreDeprecations`, `skipLibCheck`, or by turning off a strictness option the repository had on. A default 6.0 changed (`strict`, `types`, `noUncheckedSideEffectImports`, `rootDir`, `module`, `target`) is pinned to its old value only when the pull request lists it under "Decisions for you".',
    '`types` now defaults to `[]`: a "Cannot find name" error for `process`, `describe` or another global of an `@types` package is fixed by listing that package in `compilerOptions.types` of the tsconfig that compiles the file (`"types": ["node"]`), never by declaring the global.',
    'A side-effect import the compiler cannot resolve (`import "./styles.css"`, TS2882) needs a declaration (`declare module "*.css";` in a .d.ts the project includes) or the client types its bundler documents (`"types": ["vite/client"]`), never a cast.',
    'Tooling that peers on typescript (typescript-eslint, ts-node, ts-jest, tsx, framework type checkers) is reported with the range it accepts; never upgrade one across a major to get past it.',
  ].join('\n'),
});
