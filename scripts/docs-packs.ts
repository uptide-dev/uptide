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
import { rateLabel } from '../packages/core/src/packs/contract.ts';
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
    return `| \`${pack.meta.package}\` | ${range} | ${pack.rules.length} | ${rateLabel(verification.breaking, 'precision')} | ${rateLabel(verification.breaking, 'recall')} | ${verification.breakingSites ?? '—'} | ${repos.join(', ') || '—'} | ${verification.status} |`;
  });
  return [
    '| Package | From → to | Rules | Precision | Recall | Breaking sites | Ground-truth repositories | Status |',
    '| --- | --- | ---: | ---: | ---: | ---: | --- | --- |',
    ...rows,
    ...(verifiedOnly
      ? [
          '',
          `${registered.length - packs.length} more in validation: see the [compatibility matrix](docs/compatibility.md).`,
        ]
      : []),
  ].join('\n');
}

function main(): void {
  const check = process.argv.includes('--check');
  for (const document of documents) {
    const table = packsTable(document === 'README.md');
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
