/** A third-party action pinned to a full commit SHA; `tag` is the release it was taken from. */
export interface PinnedAction {
  repo: string;
  sha: string;
  tag: string;
}

/** Every action the generated workflow uses besides Uptide's own, pinned by commit. */
export const PINNED_ACTIONS = {
  checkout: {
    repo: 'actions/checkout',
    sha: '3d3c42e5aac5ba805825da76410c181273ba90b1',
    tag: 'v7.0.1',
  },
  setupNode: {
    repo: 'actions/setup-node',
    sha: '949feb2413d6458794dcd2491c4babbbce0c15c1',
    tag: 'v7.1.0',
  },
  pnpm: {
    repo: 'pnpm/action-setup',
    sha: 'ea17c68df8912ef543352723c149a84f56e3d413',
    tag: 'v6.1.0',
  },
} as const satisfies Record<string, PinnedAction>;

/**
 * The Uptide Action the workflow runs: the root action.yml of this repository, released with
 * the CLI's tags and pinned by the commit of a release tag. A release cannot name its own
 * commit, so each release pins the one before it, and the release process bumps this pin.
 *
 * v0.9.0 is the first release that ships the Uptide Action; the inputs the workflow passes
 * are only `config`, `mode`, `package` and `anthropic-api-key`. Since v0.11.0 the Action
 * requires `anthropic-api-key`, which the workflow always passes.
 */
export const UPTIDE_ACTION: PinnedAction & { released: boolean } = {
  repo: 'uptide-dev/uptide',
  sha: '63e91ef2a52815ce5d75d3bd0fb53596956afb1c',
  tag: 'v0.17.0',
  released: true,
};

/**
 * Corepack the workflow installs before using it: Node 25 and newer no longer bundle one,
 * and the copies in Node 20 and 22 reject newer pnpm and Yarn releases (signing keys changed).
 */
export const COREPACK_VERSION = '0.36.0';

export const usesLine = (action: PinnedAction): string =>
  `${action.repo}@${action.sha} # ${action.tag}`;
