import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, posix, relative } from 'node:path';
import { command } from './process.js';

export interface Generated {
  workspace: string;
  /** As typed from the workspace. */
  command: string;
  status: 'generated' | 'failed' | 'timeout';
  output?: string;
  /** Regenerated after the upgrade's install; absent before the baseline. */
  phase?: 'bump';
}

/** A code generator the workspace configures, with where it writes. */
interface Generator {
  bin: string;
  args: string[];
  /** Workspace-relative output paths; empty when it writes into node_modules. */
  outputs: string[];
  env?: Record<string, string>;
  /** Why it must not run here (a remote schema needs network beyond the registry). */
  refused?: string;
}

/**
 * Generated code the repository's own tests and types need and the checkout never holds: a
 * Prisma client, GraphQL codegen output. Installs run with scripts off, so without it every
 * import of the generated client fails and the compile signal is gone. Each generator reads
 * local files only: `prisma generate` contacts no database, and a codegen config with a remote
 * schema is reported, not run. It runs in fix's clone, with the repository's own binary.
 */
export async function generateClients(
  root: string,
  workspaces: string[],
  /** Added to each generator's environment: ground truth blocks downloads with it. */
  env: Record<string, string> = {},
): Promise<Generated[]> {
  const out: Generated[] = [];
  for (const workspace of workspaces) {
    const dir = join(root, workspace);
    for (const g of generators(dir)) {
      const typed = `${g.bin} ${g.args.join(' ')}`;
      if (g.refused) {
        out.push({ workspace, command: typed, status: 'failed', output: g.refused });
        continue;
      }
      const bin = findBin(dir, root, g.bin);
      if (!bin) continue;
      const result = await command(dir, bin, g.args, 180_000, { ...g.env, ...env });
      out.push({
        workspace,
        command: typed,
        status: result.timeout ? 'timeout' : result.code === 0 ? 'generated' : 'failed',
        ...(result.code === 0 && !result.timeout ? {} : { output: result.output.slice(-2000) }),
      });
    }
  }
  return out;
}

/**
 * The generator step whose missing output these unresolved imports name, as the user would type
 * it (`prisma generate`): check runs no scripts, so it says what to run instead.
 */
export function missingGeneratorStep(dir: string, specifiers: string[]): string | undefined {
  const g = generators(dir).find((g) =>
    specifiers.some((s) => g.outputs.some((o) => namesOutput(s, o))),
  );
  return g && (g.bin === 'prisma' ? 'prisma generate' : g.bin);
}

function generators(dir: string): Generator[] {
  const manifest = readManifest(dir);
  if (!manifest) return [];
  const found: Generator[] = [];
  const schema = prismaSchema(dir, manifest);
  if (schema)
    found.push({
      bin: 'prisma',
      args: ['generate', '--schema', relative(dir, schema)],
      outputs: prismaOutputs(dir, schema),
      env: {
        CHECKPOINT_DISABLE: '1',
        PRISMA_HIDE_UPDATE_MESSAGE: '1',
        PRISMA_GENERATE_SKIP_AUTOINSTALL: 'true',
      },
    });
  const declared = Object.keys({ ...manifest.dependencies, ...manifest.devDependencies });
  const config = ['codegen.ts', 'codegen.yml', 'codegen.yaml'].find((f) =>
    existsSync(join(dir, f)),
  );
  if (config && declared.some((d) => d.startsWith('@graphql-codegen/'))) {
    const text = readFileSync(join(dir, config), 'utf8');
    found.push({
      bin: 'graphql-codegen',
      args: ['--config', config],
      outputs: codegenOutputs(text),
      ...(/schema\s*:[^\n]*https?:\/\//.test(text)
        ? { refused: 'remote schema: not generated (no network beyond the registry)' }
        : {}),
    });
  }
  return found;
}

interface Manifest {
  prisma?: { schema?: string };
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

function readManifest(dir: string): Manifest | undefined {
  try {
    return JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as Manifest;
  } catch {
    return undefined;
  }
}

/** The workspace's Prisma schema: `prisma/schema.prisma`, or the path package.json names. */
function prismaSchema(dir: string, manifest: Manifest): string | undefined {
  if (manifest.prisma?.schema) {
    const named = join(dir, manifest.prisma.schema);
    return existsSync(named) ? named : undefined;
  }
  const conventional = join(dir, 'prisma/schema.prisma');
  return existsSync(conventional) ? conventional : undefined;
}

/** Each generator block's `output`, relative to the schema as Prisma reads it. */
function prismaOutputs(dir: string, schema: string): string[] {
  return [...readFileSync(schema, 'utf8').matchAll(/^\s*output\s*=\s*"([^"]+)"/gm)].map((m) =>
    relative(dir, join(dirname(schema), m[1] as string)),
  );
}

/** The keys under `generates` that look like paths: where codegen writes. */
function codegenOutputs(text: string): string[] {
  const at = text.search(/generates\s*:/);
  if (at < 0) return [];
  return [
    ...text
      .slice(at)
      .matchAll(
        /(?:^|[{,])\s*['"]?((?:[\w.@~-]*\/[^'":\s]*)|(?:[\w.-]+\.[cm]?[jt]sx?))['"]?\s*:/gm,
      ),
  ].map((m) => m[1] as string);
}

/**
 * Whether an import specifier reaches into a generator output: `@/generated/prisma/client` into
 * `src/generated/prisma`, `../gql/graphql` into `src/gql`. Aliases and relative prefixes are
 * dropped, and what is left must start with a trailing part of the output path. Only imports
 * that already failed to resolve are asked about.
 * ponytail: segment match, not tsconfig `paths` resolution; resolve aliases if it misfires.
 */
function namesOutput(specifier: string, output: string): boolean {
  const strip = (p: string) => p.replace(/\.[cm]?[jt]sx?$/, '').replace(/\/+$/, '');
  const spec = strip(specifier)
    .split('/')
    .filter((s) => s && s !== '.' && s !== '..' && !/^[@~#$]$/.test(s));
  const out = strip(posix.normalize(output.split('\\').join('/')))
    .split('/')
    .filter((s) => s && s !== '.');
  return out.some((_, from) => out.slice(from).every((segment, i) => spec[i] === segment));
}

/** `node_modules/.bin/<name>` from the workspace up to the project root. */
function findBin(dir: string, root: string, name: string): string | undefined {
  for (let at = dir; ; at = dirname(at)) {
    const bin = join(at, 'node_modules/.bin', name);
    if (existsSync(bin)) return bin;
    if (at === root || dirname(at) === at) return undefined;
  }
}
