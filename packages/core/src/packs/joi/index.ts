import type { Finding } from '../../domain/report.js';
import { definePack } from '../contract.js';
import type { TransformResult } from '../types.js';

/**
 * joi >=17 <18 → >=18 <19. Every rule and note says where it comes from (`meta.sources`),
 * has a fixture in `fixtures/`, and is scored against `ground-truth.json` by
 * `uptide pack test joi`. Evidence and what is not covered: RESEARCH.md.
 */

/** `{}` (or `{ }`) at the reported argument becomes `[]`; anything else is the agent's. */
function emptyDetails(text: string, finding: Pick<Finding, 'usage'>): TransformResult {
  const lines = text.split('\n');
  const index = finding.usage.line - 1;
  const line = lines[index];
  if (line === undefined) return { text, applied: false, reason: 'the reported line is gone' };
  const at = Math.max(0, finding.usage.column - 1);
  const empty = /^\{\s*\}/.exec(line.slice(at));
  if (!empty)
    return {
      text,
      applied: false,
      reason: 'details is not an empty object literal: it needs its items',
    };
  lines[index] = `${line.slice(0, at)}[]${line.slice(at + empty[0].length)}`;
  return { text: lines.join('\n'), applied: true, reason: '`{}` details is `[]`' };
}

export const joiPack = definePack({
  meta: {
    package: 'joi',
    from: '>=17 <18',
    to: '>=18 <19',
    sources: [
      {
        title: 'joi 18.0.0 release notes (hapijs/joi#2926)',
        url: 'https://github.com/hapijs/joi/issues/2926',
      },
      {
        title: 'joi type declarations at v18.0.0',
        url: 'https://github.com/hapijs/joi/blob/v18.0.0/lib/index.d.ts',
      },
      {
        title: 'joi type declarations at v17.7.0',
        url: 'https://github.com/hapijs/joi/blob/v17.7.0/lib/index.d.ts',
      },
    ],
    maintainer: 'uptide-dev',
  },
  rules: [
    {
      id: 'validation-error-details',
      summary:
        '`new ValidationError(message, details, original)` takes `details` as `ValidationErrorItem[]` (typed so since joi 17.7.0: code written against 17.0–17.6 that passes `{}` stops compiling)',
      severity: 'breaking',
      kinds: ['type'],
      symbols: /^TS2345$/,
      message: /'ValidationErrorItem\[\]'/,
      guide:
        'joi types the second argument of `new ValidationError(message, details, original)` as `ValidationErrorItem[]`. An empty `{}` becomes `[]`. Anything else becomes a list of `{ message, path, type, context }` items built from the value passed, with every message and path kept as it was; never a cast. The runtime class is unchanged, so code that reads `error.details` afterwards behaves the same.',
      rewrite: (text, finding) => emptyDetails(text, finding),
    },
  ],
  behavior: [
    {
      id: 'node-20',
      summary:
        'joi 18 requires Node.js 20 or later (`engines: ">= 20"`), with every @hapi dependency upgraded to match',
      reported: ['decision'],
    },
    {
      id: 'email-tlds',
      summary:
        '`string().email()`, `.domain()` and `.uri({ domain })` check top-level domains against @hapi/tlds instead of @sideway/address: addresses on 16 retired TLDs (avianca, bentley, comcast, dabur, dunlop, goo, guardian, kerrylogistics, lancaster, lipsy, natura, pramerica, redstone, shaw, wolterskluwer, xfinity) now fail validation and `.merck` passes, so stored data on those domains is rejected on its next write; `tlds: false` or an explicit `tlds: { allow }` keeps a fixed list',
      reported: ['decision'],
    },
  ],
  instructions:
    'joi 18 tightened its TypeScript generics; validation, error messages and the ValidationError class are unchanged at runtime (RESEARCH.md). For a compiler error from `array().items(...)`, `alternatives()`/`alt()`/`try()` or `when()`/`conditional()`: an explicit `Joi.array<T>()` moves to `Joi.array().items<T>(...)`, and these schemas now infer their value type from their arguments, so fix the declared type that disagrees with the schema, or pass the type argument to the method that now takes it, instead of casting. Never change a rule, option, message or `tlds` setting to make a type check pass.',
});
