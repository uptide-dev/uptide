// No Node imports: `uptide/onboarding` reaches this file and must run in a browser bundle.

/**
 * A glob as a RegExp over `/`-separated paths relative to the root: `*` and `?` stay inside
 * one segment, `**` spans any number of them. Brace sets (`{a,b}`) and character classes are
 * not supported; no workspace seen so far uses them.
 */
export function globRegExp(glob: string): RegExp {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i] as string;
    if (c === '*' && glob[i + 1] === '*') {
      i++;
      if (glob[i + 1] === '/') {
        i++;
        re += '(?:.*/)?';
      } else re += '.*';
    } else if (c === '*') re += '[^/]*';
    else if (c === '?') re += '[^/]';
    else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${re}$`);
}
