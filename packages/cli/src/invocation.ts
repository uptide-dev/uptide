import { uptideInvocation } from '@uptide/core';
import type { Command } from 'commander';
import { VERSION } from './version.js';

/** Match how this CLI was launched, including the prerelease channel. */
let command: string | undefined;
export const invocation = (): string => (command ??= uptideInvocation(VERSION));

/**
 * One command style in every suggestion: a command written as `uptide …` (at the start, or
 * inside backticks) is printed with the current invocation.
 */
export const runnable = (text: string): string =>
  text.replace(/(^|`)(?:npx )?uptide(?:@[\w.-]+)? (?=[a-z-])/g, `$1${invocation()} `);

export const quote = (value: string): string =>
  /^[\w./@:=+-]+$/.test(value) ? value : `'${value.replaceAll("'", "'\"'\"'")}'`;

/** Keep explicit flags accepted by the next command; its suggested scope and overrides win. */
export function repeatFlags(text: string, source: Command): string {
  const name = /^(?:npx )?uptide(?:@[\w.-]+)? (\S+)/.exec(text)?.[1];
  const program = source.parent ?? source;
  const target =
    text === invocation() ? program : program.commands.find((command) => command.name() === name);
  if (!target) return text;
  const description = / {3,}\([^)]*\)$/.exec(text)?.[0] ?? '';
  const command = text.slice(0, text.length - description.length);
  // A quoted path or model can contain flag-like text.
  const supplied = command.replace(/'[^']*'|"[^"]*"/g, '');
  const flags: string[] = [];
  for (const option of source.options) {
    const key = option.attributeName();
    if (source.getOptionValueSource(key) !== 'cli' || ['only', 'group'].includes(key)) continue;
    if (!option.long || !target.options.some((next) => next.long === option.long)) continue;
    if (
      key === 'target' &&
      (name !== source.name() || /(?:^|\s)--pin-current-api(?:\s|$)/.test(supplied))
    )
      continue;
    if (key === 'details' && source.name() === 'check' && name === 'check') continue;
    const flag = option.long.replace(/^--no-/, '--');
    if (new RegExp(`(?:^|\\s)--(?:no-)?${flag.slice(2)}(?:[\\s=]|$)`).test(supplied)) continue;
    const value: unknown = source.getOptionValue(key);
    if (typeof value === 'boolean') {
      if (value !== option.negate) flags.push(option.long);
    } else {
      for (const item of Array.isArray(value) ? value : [value])
        flags.push(option.long, quote(String(item)));
    }
  }
  return [command, ...flags].join(' ') + description;
}
