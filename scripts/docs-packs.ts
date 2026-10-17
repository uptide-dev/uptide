/**
 * The pack tables in README.md and docs/compatibility.md, generated from each registered pack: its
 * metadata, its ground truth and what `uptide pack test --write` recorded in
 * verification.json. The table sits between `<!-- packs:start -->` and `<!-- packs:end -->`.
 *
 *   pnpm docs:packs            rewrite the tables
 *   pnpm docs:packs --check    exit 1 when either table is stale (CI)
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  lowPrecisionRules,
  type PackVerification,
  RULE_PRECISION_WARNING,
  rateLabel,
  rulePrecision,
} from '../packages/core/src/packs/contract.ts';
import { registeredPacks } from '../packages/core/src/packs/index.ts';

const root = fileURLToPath(new URL('..', import.meta.url));
const documents = ['README.md', 'docs/compatibility.md'];
const START = '<!-- packs:start -->';
const END = '<!-- packs:end -->';

interface GroundTruth {
  repos: { repo?: string; fixture?: string }[];
}

/** Whole majors read as `3`, spans as `3.x/4.x`, and an open floor as `14+`. */
function rangeLabel(range: string): string {
  const bounded = /^>=(\d+) <(\d+)$/.exec(range);
  if (bounded) {
    const from = Number(bounded[1]);
    const count = Number(bounded[2]) - from;
    if (count === 1) return `${from}`;
    if (count > 1) return Array.from({ length: count }, (_, i) => `${from + i}.x`).join('/');
  }
  const floor = /^>=(\d+)$/.exec(range);
  if (floor) return `${floor[1]}+`;
  return range;
}

/** A share of the breaking sites of the repositories scored; `—` for a record written before it. */
function foundLabel(v: PackVerification, found: 'breakingFoundAny' | 'breakingFound'): string {
  const n = v[found];
  if (n === undefined || !v.breakingScored) return '—';
  return `${Math.round((n / v.breakingScored) * 100)}%`;
}

export function packsTable(verifiedOnly = false): string {
  const registered = registeredPacks();
  const packs = registered.filter(
    ({ verification }) => !verifiedOnly || verification.status === 'verified',
  );
  const rows = packs.map(({ dir, pack, verification }) => {
    const truth = JSON.parse(
      readFileSync(join(root, 'packages/core/src/packs', dir, 'ground-truth.json'), 'utf8'),
    ) as GroundTruth;
    const repos = [...new Set(truth.repos.filter((r) => r.repo).map((r) => r.repo as string))];
    const range = `${rangeLabel(pack.meta.from)} → ${pack.meta.targetDescription ?? rangeLabel(pack.meta.to)}`;
    return `| \`${pack.meta.package}\` | ${range} | ${pack.rules.length} | ${rateLabel(verification.breaking, 'precision')} | ${foundLabel(verification, 'breakingFoundAny')} | ${foundLabel(verification, 'breakingFound')} | ${verification.breakingSites ?? '—'} | ${repos.join(', ') || '—'} | ${verification.status} |`;
  });
  return [
    '| Package | From → to | Rules | Precision | Found, any severity | Found as breaking | Breaking sites | Ground-truth repositories | Status |',
    '| --- | --- | ---: | ---: | ---: | ---: | ---: | --- | --- |',
    ...rows,
    ...(verifiedOnly
      ? [
          '',
          `${registered.length - packs.length} more in validation: see the [compatibility matrix](docs/compatibility.md).`,
        ]
      : []),
  ].join('\n');
}

/**
 * Every rewrite rule's precision as `pack test --write` recorded it: real true positives against
 * every scored false positive (UPT-65). Below `RULE_PRECISION_WARNING` over `RULE_PRECISION_MIN_SITES` sites, a rule runs as assisted.
 */
export function rewritesTable(): string {
  const threshold = Math.round(RULE_PRECISION_WARNING * 100);
  const rows = registeredPacks().flatMap(({ pack, verification }) =>
    Object.entries(verification.mechanical ?? {})
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([id, r]) => {
        const p = rulePrecision(r);
        const note = verification.unexercised?.includes(id)
          ? 'unexercised: runs assisted'
          : lowPrecisionRules(verification.mechanical).includes(id)
            ? `below ${threshold}%: runs assisted`
            : p !== undefined && p < RULE_PRECISION_WARNING
              ? `below ${threshold}% on ${r.truePositives + r.falsePositives} sites, too few to judge: runs mechanical`
              : '';
        return `| \`${pack.meta.package}\` | \`${id}\` | ${p === undefined ? 'n/a' : `${Math.round(p * 100)}%`} | ${r.truePositives} | ${r.falsePositives} | ${note} |`;
      }),
  );
  return [
    '| Package | Rewrite rule | Precision | Real true positives | False positives | Note |',
    '| --- | --- | ---: | ---: | ---: | --- |',
    ...rows,
  ].join('\n');
}

function main(): void {
  const check = process.argv.includes('--check');
  for (const document of documents) {
    const table =
      document === 'README.md' ? packsTable(true) : `${packsTable()}\n\n${rewritesTable()}`;
    const path = join(root, document);
    const text = readFileSync(path, 'utf8');
    const start = text.indexOf(START);
    const end = text.indexOf(END);
    if (start < 0 || end < 0 || end < start)
      throw new Error(`${document}: expected ${START} … ${END} around the packs table`);
    const next = `${text.slice(0, start + START.length)}\n${table}\n${text.slice(end)}`;
    if (next === text) {
      console.log(`${document}: the packs table is current`);
    } else if (check) {
      console.error(`${document}: the packs table is stale; run \`pnpm docs:packs\` and commit`);
      process.exitCode = 1;
    } else {
      writeFileSync(path, next);
      console.log(`${document}: packs table rewritten`);
    }
  }
}

main();
