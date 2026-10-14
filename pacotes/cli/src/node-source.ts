import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import type { LibrarySource } from '@tv-chuvisco/nucleo';
import { CliError } from './errors';

// Folders that USB sticks and Windows drives carry and that can't be read (same list as the browser).
const SKIPPED_FOLDERS = new Set(['$recycle.bin', 'system volume information', 'node_modules']);

/** A library folder on the Node file system. Paths are relative to `dir` and use '/'. */
export interface NodeLibrarySource extends LibrarySource {
  /** Absolute path of the picked folder. */
  dir: string;
  /** Absolute path of a library path. Throws when it would leave the folder. */
  resolve(relativePath: string): string;
}

/** Same rules as the browser adapters: no dotfiles, no system folders. Symlinks are not followed. */
export async function openNodeLibrary(folder: string): Promise<NodeLibrarySource> {
  const dir = path.resolve(folder);
  const info = await stat(dir).catch(() => null);
  if (!info?.isDirectory()) throw new CliError(`A pasta "${folder}" não existe ou não é uma pasta.`);

  const files: string[] = [];
  async function walk(prefix: string) {
    let entries;
    try {
      entries = await readdir(path.join(dir, prefix), { withFileTypes: true });
    } catch {
      return; // Unreadable folder (permissions, system folder): skip it.
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (!SKIPPED_FOLDERS.has(entry.name.toLowerCase())) await walk(relative);
      } else if (entry.isFile()) {
        files.push(relative);
      }
    }
  }
  await walk('');

  const resolve = (relativePath: string) => resolveInside(dir, relativePath);
  return {
    dir,
    files,
    resolve,
    readText: (relativePath) => readFile(resolve(relativePath), 'utf8'),
  };
}

/** Joins a '/'-separated library path to `dir`, refusing anything that escapes it. */
export function resolveInside(dir: string, relativePath: string): string {
  const target = path.resolve(dir, ...relativePath.split('/'));
  const relative = path.relative(dir, target);
  if (relative === '' || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new CliError(`Caminho fora da biblioteca: ${relativePath}`);
  }
  return target;
}
