import { ts } from 'ts-morph';
import type { BehaviorNote } from '../contract.js';
import type { PackContext } from '../types.js';

const guide = 'https://nextjs.org/docs/app/guides/upgrading/version-16';
const config = /(?:^|\/)next\.config\.(?:js|mjs|ts|cjs)$/;
const source = /\.[cm]?[jt]sx?$/;
const files = (context: PackContext) => context.inventory ?? [];

const parse = (text: string) =>
  ts.createSourceFile('input.tsx', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
/** Parse keys rather than matching comments, strings or similarly named identifiers. */
function keys(text: string): string[] {
  const result: string[] = [];
  const visit = (node: ts.Node, parents: string[]): void => {
    let path = parents;
    if (
      ts.isPropertyAssignment(node) ||
      ts.isMethodDeclaration(node) ||
      ts.isShorthandPropertyAssignment(node)
    ) {
      const name = node.name;
      if (ts.isIdentifier(name) || ts.isStringLiteral(name)) {
        path = [...parents, name.text];
        result.push(path.join('.'));
      }
    }
    ts.forEachChild(node, (child) => visit(child, path));
  };
  visit(parse(text), []);
  return result;
}
function exportedVariable(text: string, name: string): ts.VariableDeclaration | undefined {
  for (const statement of parse(text).statements) {
    if (
      !ts.isVariableStatement(statement) ||
      !statement.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)
    )
      continue;
    const declaration = statement.declarationList.declarations.find(
      (d) => ts.isIdentifier(d.name) && d.name.text === name,
    );
    if (declaration) return declaration;
  }
  return undefined;
}
function found(context: PackContext, pattern: RegExp, names: readonly string[]): string | false {
  const matches = files(context)
    .filter((f) => pattern.test(f.file))
    .flatMap((f) => {
      const present = keys(f.text).filter((key) => names.includes(key));
      return present.length
        ? [`\`${f.file}\` has ${[...new Set(present)].map((k) => `\`${k}\``).join(', ')}`]
        : [];
    });
  return matches.length ? matches.join('; ') : false;
}
function note(
  id: string,
  summary: string,
  evidence: (context: PackContext) => string | false,
): BehaviorNote {
  return {
    id,
    summary,
    reported: ['decision'],
    applies(context) {
      const hit = evidence(context);
      return hit && `${hit}: ${summary}`;
    },
  };
}

export const nextBehavior: BehaviorNote[] = [
  note(
    'turbopack-default',
    'next dev/build now default to Turbopack; keep --webpack or migrate the custom webpack configuration.',
    (c) => found(c, config, ['webpack']),
  ),
  note(
    'image-defaults',
    'review image defaults (TTL 14400s, sizes omit 16, qualities [75], at most 3 redirects and blocked local IPs) and localPatterns.search; preserve image security.',
    (c) => found(c, config, ['images']),
  ),
  note(
    'cache-components',
    'cacheComponents is an opt-in model change; review caching and Suspense instead of renaming flags automatically.',
    (c) => {
      const configured = found(c, config, [
        'experimental.ppr',
        'experimental.dynamicIO',
        'experimental.useCache',
      ]);
      const routes = files(c)
        .filter((f) => /(?:^|\/)(?:src\/)?app\//.test(f.file) && source.test(f.file))
        .filter((f) => exportedVariable(f.text, 'experimental_ppr'))
        .map((f) => `\`${f.file}\` exports \`experimental_ppr\``);
      return [configured, ...routes].filter(Boolean).join('; ') || false;
    },
  ),
  note('config-conventions', 'review the Next 16 config moves/removals before building.', (c) =>
    found(c, config, [
      'experimental.turbo',
      'experimental.reactCompiler',
      'experimental.turbopackMemoryLimit',
      'turbopack.memoryLimit',
      'experimental.turbo.memoryLimit',
      'experimental.turbo.minify',
      'experimental.turbo.treeShaking',
      'experimental.turbo.sourceMaps',
    ]),
  ),
  note(
    'middleware-runtime',
    'proxy is Node-only; retain middleware if Edge is required and review the runtime before renaming.',
    (c) => {
      const middleware = files(c).filter((f) =>
        /(?:^|\/)(?:src\/)?middleware\.(?:ts|js)$/.test(f.file),
      );
      return middleware.length
        ? middleware.map((f) => `\`${f.file}\` uses the middleware convention`).join('; ')
        : false;
    },
  ),
  note(
    'lint-tooling',
    'next lint is removed and next build no longer lints; use an explicit ESLint command and CI lint gate.',
    (c) => {
      const hits = files(c)
        .filter((f) => /(?:^|\/)package\.json$/.test(f.file))
        .flatMap((f) => {
          const pkg = JSON.parse(f.text);
          return Object.entries(pkg.scripts ?? {})
            .filter(
              ([, value]) => typeof value === 'string' && /\bnext\s+(?:lint|build)\b/.test(value),
            )
            .map(
              ([name, value]) =>
                `\`${f.file}\` scripts.${name} invokes ${/\bnext\s+lint\b/.test(String(value)) ? 'next lint' : 'next build'}`,
            );
        });
      const configured = found(c, config, ['eslint']);
      return [...hits, configured].filter(Boolean).join('; ') || false;
    },
  ),
  note(
    'removed-options',
    'remove unsupported AMP/runtime config or indicator options after reviewing page behavior and server-secret visibility.',
    (c) => {
      const configured = found(c, config, [
        'amp',
        'serverRuntimeConfig',
        'publicRuntimeConfig',
        'devIndicators.appIsrStatus',
        'devIndicators.buildActivity',
        'devIndicators.buildActivityPosition',
      ]);
      const pages = files(c)
        .filter((f) => /(?:^|\/)(?:src\/)?pages\//.test(f.file) && source.test(f.file))
        .filter((f) => {
          const value = exportedVariable(f.text, 'config')?.initializer;
          return value && keys(`(${value.getText()})`).includes('amp');
        })
        .map((f) => `\`${f.file}\` exports config.amp`);
      return [configured, ...pages].filter(Boolean).join('; ') || false;
    },
  ),
  note(
    'platform-minimums',
    'verify Node >=20.9.0 and TypeScript >=5.1.0 in CI and deployment.',
    (c) => {
      const hits = files(c).flatMap((f) => {
        if (/(?:^|\/)package\.json$/.test(f.file)) {
          const pkg = JSON.parse(f.text);
          return [
            pkg.engines?.node && `\`${f.file}\` engines.node=${JSON.stringify(pkg.engines.node)}`,
            (pkg.devDependencies?.typescript ?? pkg.dependencies?.typescript) &&
              `\`${f.file}\` declares TypeScript ${JSON.stringify(pkg.devDependencies?.typescript ?? pkg.dependencies?.typescript)}`,
          ].filter((v): v is string => !!v);
        }
        if (/\.github\/workflows\/.*\.ya?ml$/.test(f.file)) {
          return f.text
            .split('\n')
            .flatMap((line, i) =>
              /^\s*node-version\s*:/.test(line)
                ? [`\`${f.file}:${i + 1}\` sets ${line.trim()}`]
                : [],
            );
        }
        if (/(?:^|\/)(?:\.nvmrc|\.node-version)$/.test(f.file))
          return [`\`${f.file}\` pins Node ${f.text.trim()}`];
        return [];
      });
      return hits.join('; ') || false;
    },
  ),
  note(
    'routing-build',
    'parallel route slots require a default file; choose null or notFound for missing fallbacks.',
    (c) => {
      const slots = new Set(
        files(c)
          .filter((f) => /(?:^|\/)(?:src\/)?app\//.test(f.file))
          .flatMap((f) =>
            [...f.file.matchAll(/(?:^|\/)@[^/]+(?=\/)/g)].map((m) =>
              f.file.slice(0, (m.index ?? 0) + m[0].length),
            ),
          ),
      );
      const missing = [...slots].filter(
        (slot) =>
          !files(c).some((f) =>
            new RegExp(`^${slot.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/default\\.[jt]sx?$`).test(
              f.file,
            ),
          ),
      );
      return missing.length
        ? missing.map((slot) => `\`${slot}/\` has no default file`).join('; ')
        : false;
    },
  ),
  {
    id: 'also-review',
    summary: `Also review the [Next 16 upgrade guide](${guide}) for metadata promises, browser support and target-minor changes.`,
    reported: ['decision'],
  },
];
