// The destination folder (the pendrive). Same care as the converter takes with the library: nothing is
// ever written through a symbolic link or junction, and the destination can't be inside the library.

import { mkdir, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { CliError } from '../errors';
import { resolveForWrite } from '../node-source';

const caseless = (value: string) => (process.platform === 'win32' || process.platform === 'darwin' ? value.toLowerCase() : value);

/** True when `child` is `parent` itself or somewhere below it (both absolute, real paths). */
export function isInside(child: string, parent: string): boolean {
  const relative = path.relative(caseless(parent), caseless(child));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

/** The real path of the nearest existing folder at or above `target`, plus the part below it that doesn't exist yet. */
async function nearestExisting(target: string): Promise<string> {
  let current = target;
  const rest: string[] = [];
  for (;;) {
    try {
      return path.join(await realpath(current), ...rest.reverse());
    } catch {
      const parent = path.dirname(current);
      if (parent === current) return target;
      rest.push(path.basename(current));
      current = parent;
    }
  }
}

/**
 * Checks the destination and returns its absolute path. Refuses a destination inside the library (the
 * pieces would end up in the library, and the library's scan would pick them up). It need not exist yet.
 */
export async function checkDestination(destination: string, libraryDir: string): Promise<string> {
  const absolute = path.resolve(destination);
  const info = await stat(absolute).catch(() => null);
  if (info && !info.isDirectory()) throw new CliError(`O destino "${destination}" existe e não é uma pasta.`);
  const real = await nearestExisting(absolute);
  const library = await nearestExisting(path.resolve(libraryDir));
  if (isInside(real, library)) {
    throw new CliError(
      `O destino "${destination}" fica dentro da biblioteca. Escolha outra pasta (o pendrive, por exemplo): ` +
        'os vídeos gerados não podem ficar misturados com os originais.',
    );
  }
  return absolute;
}

/**
 * Absolute path inside the destination for something about to be written, after checking that nothing on
 * the way is a symbolic link. `parts` are folder and file names, not paths.
 */
export function destPath(destination: string, ...parts: string[]): Promise<string> {
  return resolveForWrite(destination, parts.join('/'));
}

/** Like `destPath`, then creates the folder it names. */
export async function destFolder(destination: string, ...parts: string[]): Promise<string> {
  const folder = await destPath(destination, ...parts);
  await mkdir(folder, { recursive: true });
  return folder;
}
