import semver from 'semver';
import { parse as parseYaml } from 'yaml';
import { UptideError } from '../errors.js';

/**
 * The files the facts are read from, relative to the repository root. The App fetches these
 * through the GitHub API and `uptide init` reads them from disk, so both see the same input.
 * For lockfiles only the head matters (the format version and `__metadata`): the first
 * 64 KB is enough, and a binary `bun.lockb` only needs to be present.
 */
export const ONBOARDING_INPUTS = [
  'package.json',
  'package-lock.json',
  'npm-shrinkwrap.json',
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
  'yarn.lock',
  '.yarnrc.yml',
  'bun.lock',
  'bun.lockb',
  '.nvmrc',
  '.node-version',
  '.tool-versions',
] as const;
export type OnboardingInput = (typeof ONBOARDING_INPUTS)[number];

export interface RepoSnapshot {
  /** `owner/name`, when known: seeds the schedule so repositories do not all run at once. */
  slug?: string;
  defaultBranch: string;
  /** Contents by path; a path that is absent is a file the repository does not have. */
  files: Partial<Record<OnboardingInput, string>>;
}

export type ManagerName = 'npm' | 'pnpm' | 'yarn';

export interface RepoFacts {
  slug?: string;
  defaultBranch: string;
  /** package.json `name`. */
  name?: string;
  manager: {
    name: ManagerName;
    /** Yarn only. */
    flavor?: 'classic' | 'berry';
    /** From `packageManager`, or what the lockfile implies when nothing declares one. */
    version?: string;
    /** Set when package.json has `packageManager`: the workflow then runs it through Corepack. */
    declared?: string;
    lockfile: 'package-lock.json' | 'npm-shrinkwrap.json' | 'pnpm-lock.yaml' | 'yarn.lock';
    /** The install that never changes the lockfile and runs no lifecycle script. */
    install: string;
  };
  /** Exactly one of `file` (setup-node reads it) and `version` is set. */
  node: { file?: '.nvmrc' | '.node-version' | '.tool-versions'; version?: string; source: string };
  /** Workspace globs from pnpm-workspace.yaml or package.json; empty for a single package. */
  workspaces: string[];
}

export type RefusalReason =
  | 'not-javascript'
  | 'invalid-manifest'
  | 'bun'
  | 'no-lockfile'
  | 'several-lockfiles'
  | 'manager-mismatch'
  | 'unsupported-lockfile'
  | 'unknown-manager-version'
  | 'yarn-pnp'
  | 'unsupported-node'
  | 'unsupported-provider'
  | 'llm-disabled';

/** Why Uptide will not generate files for a repository, in words for the person who asked. */
export class OnboardingRefusal extends UptideError {
  constructor(
    readonly reason: RefusalReason,
    message: string,
  ) {
    super('ONBOARDING_REFUSED', message);
  }
}

/** Node majors, most preferred first: Active LTS, then maintenance, then the rest. */
const NODE_MAJORS = [24, 22, 20, 26, 18, 25, 23, 21, 19, 16];
/** When nothing in the repository says which Node it runs on. */
export const DEFAULT_NODE = '24';

const DECLARED = /^(npm|pnpm|yarn|bun)@(\d+\.\d+\.\d+(?:-[\w.]+)?)(?:\+[\w.-]+)?$/;

/** The facts the workflow and the pull request are written from; throws `OnboardingRefusal`. */
export function repoFacts(snapshot: RepoSnapshot): RepoFacts {
  const files = snapshot.files;
  const manifestText = files['package.json'];
  if (manifestText === undefined)
    throw new OnboardingRefusal(
      'not-javascript',
      'There is no package.json at the repository root. Uptide works on JavaScript and TypeScript repositories with a package.json and a lockfile at the root.',
    );
  let manifest: Record<string, unknown>;
  try {
    manifest = JSON.parse(manifestText);
    if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) throw new Error();
  } catch {
    throw new OnboardingRefusal('invalid-manifest', 'package.json at the root is not valid JSON.');
  }
  const name = typeof manifest.name === 'string' ? manifest.name : undefined;
  return {
    ...(snapshot.slug ? { slug: snapshot.slug } : {}),
    defaultBranch: snapshot.defaultBranch,
    ...(name ? { name } : {}),
    manager: managerFacts(files, manifest.packageManager),
    node: nodeFacts(files, manifest),
    workspaces: workspaceGlobs(files, manifest.workspaces),
  };
}

const LOCKFILES: [
  RepoFacts['manager']['lockfile'] | 'bun.lock' | 'bun.lockb',
  ManagerName | 'bun',
][] = [
  ['package-lock.json', 'npm'],
  ['npm-shrinkwrap.json', 'npm'],
  ['pnpm-lock.yaml', 'pnpm'],
  ['yarn.lock', 'yarn'],
  ['bun.lock', 'bun'],
  ['bun.lockb', 'bun'],
];

function managerFacts(files: RepoSnapshot['files'], field: unknown): RepoFacts['manager'] {
  let declared: { name: ManagerName | 'bun'; version: string; raw: string } | undefined;
  if (field !== undefined) {
    const match = typeof field === 'string' ? DECLARED.exec(field) : null;
    if (!match)
      throw new OnboardingRefusal(
        'invalid-manifest',
        'package.json "packageManager" is not in the form name@version (for example pnpm@10.17.1), so Corepack cannot use it.',
      );
    declared = {
      name: match[1] as ManagerName | 'bun',
      version: match[2] as string,
      raw: field as string,
    };
  }
  const present = LOCKFILES.filter(([file]) => files[file] !== undefined);
  if (
    declared?.name === 'bun' ||
    (!declared && present.length > 0 && present.every(([, m]) => m === 'bun'))
  )
    throw new OnboardingRefusal(
      'bun',
      `This repository uses Bun (${declared ? `packageManager is ${declared.raw}` : present.map(([f]) => f).join(', ')}). Uptide supports npm, pnpm and Yarn; Bun is not supported yet.`,
    );
  if (present.length === 0)
    throw new OnboardingRefusal(
      'no-lockfile',
      'There is no lockfile at the repository root (package-lock.json, pnpm-lock.yaml or yarn.lock). Uptide installs exactly what the lockfile pins; commit one first.',
    );
  let pick: (typeof present)[number] | undefined;
  if (declared) {
    pick = present.find(([, m]) => m === declared.name);
    if (!pick)
      throw new OnboardingRefusal(
        'manager-mismatch',
        `package.json says packageManager ${declared.raw}, but the lockfile is ${present.map(([f]) => f).join(', ')}. Make them agree (regenerate the lockfile with ${declared.name}, or change packageManager), then try again.`,
      );
  } else {
    const managers = [...new Set(present.map(([, m]) => m))];
    if (managers.length > 1)
      throw new OnboardingRefusal(
        'several-lockfiles',
        `There are several lockfiles (${present.map(([f]) => f).join(', ')}) and no "packageManager" in package.json to say which one is used. Remove the stale ones, or set packageManager.`,
      );
    pick = present[0];
  }
  const [lockfile, name] = pick as [RepoFacts['manager']['lockfile'], ManagerName];
  const text = files[lockfile] ?? '';
  const base = {
    name,
    lockfile,
    ...(declared ? { declared: declared.raw } : {}),
  };
  if (name === 'npm') {
    const version = Number(/"lockfileVersion"\s*:\s*(\d+)/.exec(text)?.[1]);
    if (version !== 2 && version !== 3)
      throw new OnboardingRefusal(
        'unsupported-lockfile',
        `${lockfile} has lockfileVersion ${Number.isNaN(version) ? 'missing' : version}; Uptide needs version 2 or 3 (npm 7 or newer). Run \`npm install --package-lock-only\` with a current npm and commit the result.`,
      );
    return {
      ...base,
      ...(declared ? { version: declared.version } : {}),
      install: 'npm ci --ignore-scripts --no-audit --no-fund',
    };
  }
  if (name === 'pnpm') {
    const lockVersion = /^lockfileVersion:\s*['"]?([\d.]+)/m.exec(text)?.[1];
    const lockMajor = Number(lockVersion?.split('.')[0]);
    if (declared) {
      const major = semver.major(declared.version);
      if (lockMajor >= 9 && major < 9)
        throw new OnboardingRefusal(
          'manager-mismatch',
          `package.json says packageManager ${declared.raw}, but pnpm-lock.yaml was written by pnpm 9 or newer (lockfileVersion ${lockVersion}). Make them agree, then try again.`,
        );
    }
    const implied =
      lockMajor >= 9 ? '10' : lockMajor === 6 ? '8' : lockVersion === '5.4' ? '7' : undefined;
    if (!declared && !implied)
      throw new OnboardingRefusal(
        'unknown-manager-version',
        `pnpm-lock.yaml has lockfileVersion ${lockVersion ?? 'missing'}, which does not say which pnpm wrote it. Set "packageManager" in package.json (for example pnpm@10.17.1).`,
      );
    return {
      ...base,
      version: declared?.version ?? (implied as string),
      install: 'pnpm install --frozen-lockfile --ignore-scripts',
    };
  }
  // Yarn: Berry's lockfile starts with __metadata; classic's does not.
  const berry = /^__metadata:/m.test(text);
  const yarnrc = readYarnrc(files['.yarnrc.yml']);
  if (declared) {
    const major = semver.major(declared.version);
    if (berry !== major >= 2)
      throw new OnboardingRefusal(
        'manager-mismatch',
        `package.json says packageManager ${declared.raw}, but yarn.lock is in the Yarn ${berry ? 'Berry (2 or newer)' : 'classic (1)'} format. Make them agree, then try again.`,
      );
  }
  if (!berry)
    return {
      ...base,
      flavor: 'classic',
      ...(declared ? { version: declared.version } : {}),
      install: 'yarn install --frozen-lockfile --ignore-scripts --non-interactive',
    };
  const pathVersion = /yarn-(\d+\.\d+\.\d+[\w.-]*)\.c?js$/.exec(yarnrc.yarnPath ?? '')?.[1];
  const version = declared?.version ?? pathVersion;
  if (!declared && !yarnrc.yarnPath)
    throw new OnboardingRefusal(
      'unknown-manager-version',
      'yarn.lock is in the Yarn Berry format, but neither "packageManager" in package.json nor yarnPath in .yarnrc.yml says which Yarn to run. Set packageManager (for example yarn@4.9.2).',
    );
  if (yarnrc.nodeLinker !== 'node-modules' && yarnrc.nodeLinker !== 'pnpm')
    throw new OnboardingRefusal(
      'yarn-pnp',
      "This repository uses Yarn Plug'n'Play (no \"nodeLinker: node-modules\" in .yarnrc.yml). Uptide reads installed packages from node_modules, so Plug'n'Play is not supported.",
    );
  const skipBuilds =
    version && semver.valid(version) && semver.major(version) < 3
      ? '--skip-builds'
      : '--mode=skip-build';
  return {
    ...base,
    flavor: 'berry',
    ...(version ? { version } : {}),
    install: `yarn install --immutable ${skipBuilds}`,
  };
}

function readYarnrc(text: string | undefined): { yarnPath?: string; nodeLinker?: string } {
  if (text === undefined) return {};
  try {
    const doc = parseYaml(text) as Record<string, unknown> | null;
    return {
      ...(typeof doc?.yarnPath === 'string' ? { yarnPath: doc.yarnPath } : {}),
      ...(typeof doc?.nodeLinker === 'string' ? { nodeLinker: doc.nodeLinker } : {}),
    };
  } catch {
    return {};
  }
}

function nodeFacts(
  files: RepoSnapshot['files'],
  manifest: Record<string, unknown>,
): RepoFacts['node'] {
  for (const file of ['.nvmrc', '.node-version'] as const) {
    const text = files[file]?.trim();
    if (text) return { file, source: `${file} (${text.split(/\s/)[0]})` };
  }
  const tool = /^nodejs\s+(\S+)/m.exec(files['.tool-versions'] ?? '')?.[1];
  if (tool) return { file: '.tool-versions', source: `.tool-versions (${tool})` };
  const volta = (manifest.volta as { node?: unknown } | undefined)?.node;
  if (typeof volta === 'string' && semver.valid(volta))
    return { version: volta, source: `package.json volta.node (${volta})` };
  const engines = (manifest.engines as { node?: unknown } | undefined)?.node;
  if (typeof engines === 'string' && engines.trim()) {
    const range = semver.validRange(engines);
    const major = range ? NODE_MAJORS.find((m) => semver.intersects(range, `${m}.x`)) : undefined;
    if (major === undefined)
      throw new OnboardingRefusal(
        'unsupported-node',
        `package.json engines.node is "${engines}", which no Node release Uptide can run on satisfies (${[...NODE_MAJORS].sort((a, b) => a - b).join(', ')}). Add an .nvmrc with the version CI should use.`,
      );
    return { version: String(major), source: `package.json engines.node (${engines})` };
  }
  return {
    version: DEFAULT_NODE,
    source: `no .nvmrc, .node-version or engines.node; Node ${DEFAULT_NODE} (LTS)`,
  };
}

function workspaceGlobs(files: RepoSnapshot['files'], field: unknown): string[] {
  const strings = (list: unknown): string[] =>
    Array.isArray(list) ? list.filter((p): p is string => typeof p === 'string') : [];
  const pnpm = files['pnpm-workspace.yaml'];
  if (pnpm !== undefined) {
    try {
      return strings((parseYaml(pnpm) as { packages?: unknown } | null)?.packages);
    } catch {
      throw new OnboardingRefusal('invalid-manifest', 'pnpm-workspace.yaml is not valid YAML.');
    }
  }
  return strings(
    Array.isArray(field) ? field : (field as { packages?: unknown } | undefined)?.packages,
  );
}
