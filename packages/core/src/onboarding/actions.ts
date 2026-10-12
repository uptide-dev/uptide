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
 * TODO(UPT-19): the root action.yml is still the older pull-request checker, which does not
 * take these inputs, so this pin (v0.7.5) cannot run the generated workflow yet. When the
 * Uptide Action ships in a release, UPT-19 pins that tag's commit here and sets `released`
 * to true; nothing else in the generator changes. The inputs the workflow passes are only
 * `config`, `mode`, `package` and `anthropic-api-key`.
 */
export const UPTIDE_ACTION: PinnedAction & { released: boolean } = {
  repo: 'uptide-dev/uptide',
  sha: '9172aece4e429af11425aa592d5fb8dd5757fd70',
  tag: 'v0.7.5',
  released: false,
};

/**
 * Corepack the workflow installs before using it: Node 25 and newer no longer bundle one,
 * and the copies in Node 20 and 22 reject newer pnpm and Yarn releases (signing keys changed).
 */
export const COREPACK_VERSION = '0.36.0';

export const usesLine = (action: PinnedAction): string =>
  `${action.repo}@${action.sha} # ${action.tag}`;
