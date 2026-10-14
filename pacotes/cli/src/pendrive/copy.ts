// `--copiar-biblioteca`: puts a copy of the library on the pendrive (in `biblioteca/`), so the same stick
// works in the app on a TV box. Dotfiles (`.originais` with the converter's leftovers) and system folders are
// not copied, and a file that is already there with the same size and date is skipped, so rerunning is quick.

import { createReadStream, createWriteStream } from 'node:fs';
import { realpath, rename, rm, stat, utimes } from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import type { NodeLibrarySource } from '../node-source';
import { destFolder, destPath, isInside } from './dest';
import { LIBRARY_FOLDER, partialName } from './names';

/** FAT stores dates with 2-second precision. */
const MTIME_TOLERANCE_MS = 2500;

export interface CopyResult {
  copied: number;
  skipped: number;
  bytes: number;
  failures: { file: string; message: string }[];
  /** True when the destination's `biblioteca` is the library itself, so there was nothing to copy. */
  sameFolder: boolean;
  interrupted: boolean;
}

/** Whether a file already at the destination is the same as the source (same size, same date within FAT's precision). */
export function isUpToDate(source: { size: number; mtimeMs: number }, target: { size: number; mtimeMs: number } | null): boolean {
  return target !== null && target.size === source.size && Math.abs(target.mtimeMs - source.mtimeMs) <= MTIME_TOLERANCE_MS;
}

/** Library files to copy: everything the library scan sees (no dotfiles, no system folders), relative to the library folder. */
export function filesToCopy(files: readonly string[], root: string): string[] {
  return files.filter((file) => file.startsWith(root)).map((file) => file.slice(root.length));
}

export async function copyLibrary(
  source: NodeLibrarySource,
  root: string,
  destination: string,
  signal: AbortSignal,
  onFile?: (file: string, done: number, total: number) => void,
): Promise<CopyResult> {
  const result: CopyResult = { copied: 0, skipped: 0, bytes: 0, failures: [], sameFolder: false, interrupted: false };
  const libraryDir = path.join(source.dir, root);
  const target = await destPath(destination, LIBRARY_FOLDER);

  // The pendrive may be the library's own folder (the library already lives there).
  const realTarget = await realpath(target).catch(() => null);
  if (realTarget && isInside(realTarget, await realpath(libraryDir)) && isInside(await realpath(libraryDir), realTarget)) {
    result.sameFolder = true;
    return result;
  }

  const files = filesToCopy(source.files, root);
  await destFolder(destination, LIBRARY_FOLDER);
  let index = 0;
  for (const file of files) {
    if (signal.aborted) {
      result.interrupted = true;
      break;
    }
    index++;
    onFile?.(file, index, files.length);
    const from = path.join(libraryDir, ...file.split('/'));
    try {
      const info = await stat(from);
      const to = await destPath(destination, LIBRARY_FOLDER, file);
      if (isUpToDate(info, await stat(to).catch(() => null))) {
        result.skipped++;
        continue;
      }
      await destFolder(destination, LIBRARY_FOLDER, ...file.split('/').slice(0, -1));
      const partial = path.join(path.dirname(to), partialName(path.basename(to)));
      try {
        await pipeline(createReadStream(from), createWriteStream(partial), { signal });
        await utimes(partial, info.atime, info.mtime);
        await rename(partial, to);
      } catch (error) {
        await rm(partial, { force: true });
        throw error;
      }
      result.copied++;
      result.bytes += info.size;
    } catch (error) {
      if (signal.aborted) {
        result.interrupted = true;
        break;
      }
      result.failures.push({ file, message: (error as Error).message });
    }
  }
  return result;
}
