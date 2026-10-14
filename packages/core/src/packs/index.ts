import { UptideError } from '../errors.js';
import { type PackStatus, type RegisteredPack, recordedStatus } from './contract.js';
import { REGISTRY } from './registry.js';
import type { MigrationPack } from './types.js';

/** Every pack in this tree, candidates included: what `uptide pack test` scores. */
export function registeredPacks(): readonly RegisteredPack[] {
  return REGISTRY;
}

export function packStatus(entry: RegisteredPack): PackStatus {
  return recordedStatus(entry.verification);
}

/**
 * Verified packs by default. Local `check`/`fix` smoke tests may explicitly opt in to
 * registered packs whose record says candidate. Missing, blocked or inconsistent records
 * do not qualify; `list` and the Action keep the verified-only default.
 */
export function activePacks(allowCandidate = false): readonly MigrationPack[] {
  return REGISTRY.filter(
    (e) =>
      packStatus(e) === 'verified' || (allowCandidate && e.verification?.status === 'candidate'),
  ).map((e) => e.pack);
}

export function activePack(name: string, allowCandidate = false): MigrationPack | undefined {
  return activePacks(allowCandidate).find((p) => p.name === name);
}

/** Persisted on local smoke runs, so later publication cannot lose the safety boundary. */
export const CANDIDATE_WARNING = 'candidate pack, not verified' as const;

export function candidatePack(pack: MigrationPack | undefined): boolean {
  return (
    pack !== undefined &&
    REGISTRY.some((entry) => entry.pack === pack && entry.verification?.status === 'candidate')
  );
}

/** Refuse before reading a checkout, cloning, resolving packages or requesting credentials. */
export function assertCandidateLocal(options: {
  allowCandidate?: boolean;
  pr?: boolean;
  yes?: boolean;
  forPublication?: boolean;
}): void {
  if (options.allowCandidate && (options.pr || options.yes || options.forPublication))
    throw new UptideError(
      'PUBLICATION_REFUSED',
      '--allow-candidate cannot be used with --pr or --yes; candidate packs are for local smoke tests only',
    );
}
