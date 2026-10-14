import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import type { PackFileEdit } from '../packs/types.js';

/** All paths are validated and contents staged before writes; verification failure restores every file. */
export async function fileTransaction(
  root: string,
  edits: readonly PackFileEdit[],
  verify: () => Promise<boolean>,
): Promise<{ applied: boolean; files: string[]; reason: string }> {
  const snapshots = new Map<string, { bytes: Buffer; mode: number } | undefined>();
  const staged = new Map<string, Buffer | undefined>();
  const modes = new Map<string, number>();
  const createdDirs: string[] = [];
  const realRoot = realpathSync(root);
  const path = (file: string): string => {
    if (
      !file ||
      isAbsolute(file) ||
      file.split(/[\\/]/).some((part) => part === '..' || part === '.git') ||
      file.includes('\0')
    )
      throw new Error(`Invalid transaction path: ${file}`);
    const absolute = resolve(realRoot, file);
    if (absolute === realRoot) throw new Error(`Invalid transaction path: ${file}`);
    for (let part = absolute; part !== realRoot; part = dirname(part)) {
      if (existsSync(part) && lstatSync(part).isSymbolicLink())
        throw new Error(`Transaction refuses symlink: ${file}`);
    }
    if (!snapshots.has(absolute)) {
      if (existsSync(absolute) && !lstatSync(absolute).isFile())
        throw new Error(`Not a regular file: ${file}`);
      const before = existsSync(absolute)
        ? { bytes: readFileSync(absolute), mode: lstatSync(absolute).mode }
        : undefined;
      snapshots.set(absolute, before);
      staged.set(absolute, before?.bytes);
      if (before) modes.set(absolute, before.mode);
    }
    return absolute;
  };
  const ensureParent = (file: string): void => {
    const missing: string[] = [];
    for (let part = dirname(file); !existsSync(part); part = dirname(part)) missing.push(part);
    for (const dir of missing.reverse()) {
      mkdirSync(dir);
      createdDirs.push(dir);
    }
  };
  try {
    for (const edit of edits) {
      const file = path(edit.file);
      const current = staged.get(file);
      if (edit.kind === 'create') {
        if (current !== undefined) throw new Error(`Create destination exists: ${edit.file}`);
        staged.set(file, Buffer.from(edit.text));
      } else {
        if (current === undefined) throw new Error(`Source file missing: ${edit.file}`);
        if (edit.kind === 'write') staged.set(file, Buffer.from(edit.text));
        else if (edit.kind === 'delete') staged.set(file, undefined);
        else {
          const to = path(edit.to);
          if (staged.get(to) !== undefined)
            throw new Error(`Rename destination exists: ${edit.to}`);
          staged.set(to, current);
          const mode = modes.get(file);
          if (mode !== undefined) modes.set(to, mode);
          staged.set(file, undefined);
        }
      }
    }
  } catch (error) {
    return { applied: false, files: [], reason: String(error) };
  }
  try {
    for (const [file, bytes] of staged) {
      if (bytes === undefined) rmSync(file, { force: true });
      else {
        ensureParent(file);
        writeFileSync(file, bytes);
        const mode = modes.get(file);
        if (mode !== undefined) chmodSync(file, mode);
      }
    }
    if (!(await verify())) throw new Error('multi-file edit failed verification');
    return {
      applied: true,
      files: [...staged.keys()].map((file) => relative(realRoot, file)),
      reason: 'multi-file edit verified',
    };
  } catch (error) {
    for (const [file, before] of snapshots) {
      if (!before) rmSync(file, { force: true });
      else {
        ensureParent(file);
        writeFileSync(file, before.bytes);
        chmodSync(file, before.mode);
      }
    }
    for (const dir of createdDirs.reverse()) rmSync(dir, { recursive: true, force: true });
    return { applied: false, files: [], reason: String(error) };
  }
}
