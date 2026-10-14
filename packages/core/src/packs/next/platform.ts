import { parse } from 'yaml';
import { minVersion, satisfies } from '../../fetch/range.js';
import type { PackContext } from '../types.js';

/** Only actionable minima: a declaration permits an older runtime, or none can be read. */
export function platformEvidence(context: PackContext): string | false {
  const found: Record<'Node' | 'TypeScript', { where: string; version: string }[]> = {
    Node: [],
    TypeScript: [],
  };
  for (const { file, text } of context.inventory ?? []) {
    if (/(?:^|\/)package\.json$/.test(file)) {
      const pkg = JSON.parse(text);
      if (pkg.engines?.node)
        found.Node.push({ where: `\`${file}\` engines.node`, version: pkg.engines.node });
      const version = pkg.devDependencies?.typescript ?? pkg.dependencies?.typescript;
      if (version) found.TypeScript.push({ where: `\`${file}\` TypeScript`, version });
    } else if (/(?:^|\/)(?:\.nvmrc|\.node-version)$/.test(file)) {
      found.Node.push({ where: `\`${file}\` Node`, version: text.trim() });
    } else if (/\.github\/workflows\/.*\.ya?ml$/.test(file)) {
      // Parse matrix versions as well as literal setup-node values; no workflow execution.
      try {
        const workflow = parse(text);
        for (const job of Object.values(workflow?.jobs ?? {}) as {
          steps?: { with?: Record<string, unknown> }[];
          strategy?: { matrix?: Record<string, unknown> };
        }[]) {
          for (const step of job.steps ?? []) {
            const value = step.with?.['node-version'];
            if (value === undefined) continue;
            const matrix = /^\$\{\{\s*matrix\.([\w-]+)\s*\}\}$/.exec(String(value));
            const versions = matrix ? job.strategy?.matrix?.[matrix[1] as string] : value;
            for (const version of Array.isArray(versions) ? versions : [versions])
              if (version !== undefined)
                found.Node.push({ where: `\`${file}\` node-version`, version: String(version) });
          }
        }
      } catch {
        /* An unreadable declaration is reported as unknown below. */
      }
    }
  }
  const issues = (['Node', 'TypeScript'] as const).flatMap((kind) => {
    const minimum = kind === 'Node' ? '20.9.0' : '5.1.0';
    const versions = found[kind].map((hit) => ({
      ...hit,
      minimum: minVersion(hit.version.replace(/^v(?=\d)/, '')),
    }));
    const readable = versions.filter((hit) => hit.minimum);
    const low = readable.filter((hit) => !satisfies(hit.minimum as string, `>=${minimum}`));
    if (low.length)
      return low.map(
        (hit) => `${hit.where} ${JSON.stringify(hit.version)} permits ${kind} below ${minimum}`,
      );
    return readable.length
      ? []
      : [
          `No ${kind} version found in the inventoried package.json, runtime pins${kind === 'Node' ? ' or CI' : ''}; verify ${kind} >=${minimum}`,
        ];
  });
  return issues.join('; ') || false;
}
