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
 * The Uptide Action the workflow runs.
 *
 * TODO(UPT-19): the Action is not written yet. This points at the repository commit this
 * generator shipped from, whose action.yml is the older pull-request checker and does not
 * take these inputs. UPT-19 replaces `sha` and `tag` with its first release and sets
 * `released` to true; nothing else in the generator changes. The inputs the workflow
 * passes are only `config`, `mode`, `package` and `anthropic-api-key`.
 */
export const UPTIDE_ACTION: PinnedAction & { released: boolean } = {
  repo: 'uptide-dev/uptide',
  sha: '405f429c88b417c3005f02090031d3dc5a09d1ce',
  tag: 'unreleased',
  released: false,
};

/**
 * Corepack the workflow installs before using it: Node 25 and newer no longer bundle one,
 * and the copies in Node 20 and 22 reject newer pnpm and Yarn releases (signing keys changed).
 */
export const COREPACK_VERSION = '0.36.0';

export const usesLine = (action: PinnedAction): string =>
  `${action.repo}@${action.sha} # ${action.tag}`;
