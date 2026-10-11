import { UptideError } from '../errors.js';
import { UPTIDE_COMMAND } from '../version.js';
import { git } from './process.js';
import type { FixReport } from './types.js';

/** A successful compiler run only covers this exact committed tree. */
export function assertVerifiedTree(root: string, report: FixReport, read: typeof git = git): void {
  let tree = 'missing branch';
  try {
    tree = read(root, 'rev-parse', '--verify', `refs/heads/${report.branch}^{tree}`);
  } catch {
    // A missing ref cannot contain the verified work.
  }
  if (!report.verifiedTree || tree !== report.verifiedTree)
    throw new UptideError(
      'VERIFIED_TREE_MISMATCH',
      `${report.branch}: repository tree ${tree} does not match the recorded verified tree ${report.verifiedTree ?? '(not recorded)'}. Nothing will be pushed. ${report.verifiedTree ? `Restore the verified tree, or run \`${UPTIDE_COMMAND} verify --branch ${report.branch}\` to verify intentional changes before publication.` : `Run \`${UPTIDE_COMMAND} verify --branch ${report.branch}\` first.`}`,
    );
}
