import type { Finding } from '../domain/report.js';
import { UptideError } from '../errors.js';
import {
  lowPrecisionRules,
  type PackStatus,
  type RegisteredPack,
  recordedStatus,
} from './contract.js';
import { withUnexercised } from './fixability.js';
import { packInventory } from './inventory.js';
import { REGISTRY } from './registry.js';
import type { MigrationPack, PackContext } from './types.js';

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
  ).map((e) =>
    withUnexercised(
      e.pack,
      e.verification?.unexercised,
      lowPrecisionRules(e.verification?.mechanical),
    ),
  );
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

/**
 * The lead's pack, with each companion's pack answering for its own package's sites: a peer
 * blocker moved across a major its pack covers (UPT-10) is migrated in the same fix.
 */
export function withCompanionPacks(
  lead: MigrationPack,
  companions: readonly MigrationPack[],
): MigrationPack {
  if (!companions.length) return lead;
  const of = (finding: Finding): MigrationPack =>
    companions.find((p) => p.name === finding.change.package) ?? lead;
  // A companion's site migrates between its own versions, with its own scan context.
  const own = (finding: Finding, context: PackContext): PackContext => {
    if (of(finding) === lead) return context;
    const mine = context.companions?.[finding.change.package] ?? context;
    return { ...mine, from: finding.change.from, to: finding.change.to, helpers: context.helpers };
  };
  return {
    ...lead,
    // Each companion's detect-based rules run over its own package: its versions, its usages
    // and its own inventory. Without this they never fire (UPT-89).
    runtimeFindings: (input) => [
      ...(lead.runtimeFindings?.(input) ?? []),
      ...companions.flatMap((pack) => {
        const own = input.companions?.find((c) => c.name === pack.name);
        return own && pack.runtimeFindings
          ? pack.runtimeFindings({
              ...input,
              ...own,
              files: packInventory(input.root, input.workspace, pack.inventory),
              companions: [],
            })
          : [];
      }),
    ],
    // A section per companion that moved, with its own review notes and sections.
    reviewSections: (context, rules) => [
      ...(lead.reviewSections?.(context, rules) ?? []),
      ...companions.flatMap((pack) => {
        const mine = context.companions?.[pack.name];
        return mine
          ? [
              { title: `${pack.name} ${mine.from} → ${mine.to}`, lines: pack.reviewNotes(mine) },
              ...(pack.reviewSections?.(mine, rules) ?? []),
            ]
          : [];
      }),
    ],
    rules: [...lead.rules, ...companions.flatMap((p) => p.rules)],
    unexercised: [lead, ...companions].flatMap((p) => p.unexercised ?? []),
    lowPrecision: [lead, ...companions].flatMap((p) => p.lowPrecision ?? []),
    transform: (text, finding, context) =>
      of(finding).transform(text, finding, own(finding, context)),
    guide: (finding, context) => of(finding).guide(finding, context && own(finding, context)),
    ruleOf: (finding) => of(finding).ruleOf?.(finding),
    validateAssisted: (text, finding, explanation, original, context) =>
      of(finding).validateAssisted?.(
        text,
        finding,
        explanation,
        original,
        context && own(finding, context),
      ),
  };
}
