// File names of the pendrive (docs/pendrive.md). A TV's player lists a folder alphabetically, so the
// names start with the day and part numbers, zero-padded. FAT32 (the usual pendrive format) forbids
// : " * ? < > | / \ and a few Windows device names, so only safe characters are ever generated.

/** The folder with the files to play. Ordinary TVs open it; the app on a TV box ignores it. */
export const PLAY_FOLDER = 'ASSISTA AQUI';
/** Optional copy of the library, so the app on a TV box can use the same pendrive. */
export const LIBRARY_FOLDER = 'biblioteca';
export const README_FILE = 'LEIA-ME.txt';
/** Work folder inside the destination: rendered pieces, kept until the job ends so a rerun resumes. */
export const TEMP_FOLDER = '.tv-gominho-tmp';

const FORBIDDEN = /[<>:"/\|?*\u0000-\u001f]/g;

/** Replaces what FAT32 and Windows do not accept in a file name, and trailing dots and spaces. */
export function fatSafeName(name: string): string {
  const cleaned = name.replace(FORBIDDEN, '-').replace(/[. ]+$/, '');
  return /^(con|prn|aux|nul|com\d|lpt\d)(\..*)?$/i.test(cleaned) ? `_${cleaned}` : cleaned;
}

/** How many digits numbers up to `count` need, at least `min`: 5 days -> 2 ("01"), 120 days -> 3 ("001"). */
export function digitsFor(count: number, min: number): number {
  return Math.max(min, String(Math.max(0, Math.floor(count))).length);
}

export interface PartNaming {
  /** Digits of the day number. */
  dayDigits: number;
  /** Digits of the part number. */
  partDigits: number;
}

/** Naming for a job of `days` days with at most `maxParts` parts in a day. */
export function partNaming(days: number, maxParts: number): PartNaming {
  return { dayDigits: digitsFor(days, 2), partDigits: digitsFor(maxParts, 1) };
}

/** "Dia 01 - Parte 1.mp4": alphabetical order is playing order. */
export function partFileName(day: number, part: number, naming: PartNaming): string {
  return `Dia ${String(day).padStart(naming.dayDigits, '0')} - Parte ${String(part).padStart(naming.partDigits, '0')}.mp4`;
}

/** True for a name that `partFileName` could have produced (any padding). */
export function isPartFileName(name: string): boolean {
  return /^Dia \d+ - Parte \d+\.mp4$/i.test(name);
}

/** Hidden work-in-progress name next to (or inside) a folder: `.name.parcial`. Never ends in .mp4 so no player lists it. */
export function partialName(name: string): string {
  return `.${name}.parcial`;
}
