// Classifies one finished `uptide check` or `uptide fix --no-llm` step.
//
// Classes: success | expected | crash | false-refusal | timeout | wrong-exit-code | other
//
// `expected` is an outcome the docs promise and the run was set up to provoke: `fix --no-llm`
// on a dependency without a pack exits 2 before cloning. It is listed, never counted as a defect.
// Everything else that is not a success carries a `fingerprint`: a short, repo-independent
// string, so equal fingerprints across repositories are one root cause.
//
// The classifier is mechanical. A `false-refusal` is every exit 2 that is not an expected one;
// summary.md records the human pass that confirms or reclassifies each fingerprint.

const CONTRACT = new Set([0, 1, 2]);

/** The first line that explains an exit, with the parts that differ per repository removed. */
export function fingerprintOf(text) {
  const lines = text
    .split('\n')
    // biome-ignore lint/suspicious/noControlCharactersInRegex: strips ANSI colors
    .map((l) => l.replace(/\u001b\[[0-9;]*m/g, '').trim())
    .filter(Boolean);
  const line =
    lines.find((l) => /^(error|fatal|✗|x)\b[: ]/i.test(l)) ??
    lines.find((l) => /(error|cannot|could not|failed|unsupported|not supported|refus)/i.test(l)) ??
    lines[0] ??
    '(no output)';
  return line
    .replace(/@[\w-]+\/[\w.-]+/g, '<pkg>')
    .replace(/(\/[\w.@+~-]+)+/g, '<path>')
    .replace(/\b[0-9a-f]{7,40}\b/g, '<sha>')
    .replace(/\b\d+(\.\d+){1,3}([-+][\w.]+)?\b/g, '<v>')
    .replace(/\b\d+\b/g, '<n>')
    .slice(0, 160);
}

const UNCAUGHT = [
  /^Node\.js v\d+/m,
  /FATAL ERROR:/,
  /JavaScript heap out of memory/,
  /UnhandledPromiseRejection/,
  /(^\s+at .+:\d+:\d+\)?\n){3,}/m,
];

export function classify({ step, exit, signal, timedOut, stdout = '', stderr = '', json = null }) {
  const jsonError =
    typeof json?.error?.message === 'string' ? `error: ${json.error.message}\n` : '';
  const text = `${jsonError}${stderr}\n${stdout.length < 4000 ? stdout : ''}`;
  const done = (kind, reason, fp) => ({
    kind,
    reason,
    fingerprint: kind === 'success' ? null : `${step}: ${fp ?? fingerprintOf(text)}`,
  });

  if (timedOut) return done('timeout', 'killed at the step timeout', 'timeout');
  if (signal) return done('crash', `ended by ${signal}`, `signal ${signal}`);
  if (
    UNCAUGHT.some((re) => re.test(stderr)) ||
    /JS heap out of memory|Worker terminated due to/.test(text)
  ) {
    return done('crash', 'uncaught exception or out of memory', undefined);
  }
  if (!CONTRACT.has(exit)) {
    return done('wrong-exit-code', `exit ${exit} is outside 0, 1, 2`, `exit ${exit}`);
  }

  if (step === 'check') {
    const s = json?.summary;
    if (!s) {
      return done(
        'wrong-exit-code',
        `exit ${exit} without a parsable --json result`,
        `exit ${exit} without json`,
      );
    }
    const breaking = s.breaking > 0;
    const failed = s.failed > 0;
    if (exit === 0 && (breaking || failed)) {
      return done(
        'wrong-exit-code',
        `exit 0 with ${s.breaking} breaking, ${s.failed} failed`,
        'exit 0 despite findings',
      );
    }
    if (exit === 1 && !breaking) {
      return done('wrong-exit-code', 'exit 1 with nothing breaking', 'exit 1 without breaking');
    }
    if (exit === 2 && breaking) {
      return done(
        'wrong-exit-code',
        'exit 2 although breaking changes were found (docs: 1)',
        'exit 2 with breaking',
      );
    }
    if (exit === 2) return refusal(done, text);
    return {
      kind: 'success',
      reason: exit === 0 ? 'nothing breaking' : 'breaking found',
      fingerprint: null,
    };
  }

  // fix --no-llm
  if (exit === 0) return { kind: 'success', reason: 'migration verified', fingerprint: null };
  if (exit === 2) {
    if (/peer blockers? to resolve first|INCONSISTENT_UPGRADE/.test(text)) {
      // docs/commands/fix.md: an unresolved peer conflict stops with exit 2, before cloning.
      return done('expected', 'documented preflight stop: peer blocker', 'peer blocker');
    }
    if (/has no migration pack/.test(text)) {
      // docs/commands/fix.md: with --no-llm and no pack it "exits before creating a clone".
      if (/Nothing was changed: no clone/.test(text)) {
        return done(
          'expected',
          'no pack, assisted fixes off: documented exit 2',
          'no migration pack',
        );
      }
      return done(
        'other',
        'no-pack refusal came after work, not before the clone',
        'no-pack refusal after clone',
      );
    }
    return refusal(done, text);
  }
  return done('other', 'migration did not verify', undefined);
}

function refusal(done, text) {
  if (
    /ENOTFOUND|ECONNREFUSED|ECONNRESET|EAI_AGAIN|ETIMEDOUT|fetch failed|socket hang up/i.test(text)
  ) {
    return done('other', 'network error reaching the registry', 'network error');
  }
  return done('false-refusal', 'exit 2 on a repository list accepted', undefined);
}
