// Backup copies of grade files. When the app replaces a channel it first keeps the old file in grades/ next to it.
// A backup must never load as a channel, and the library only reads grades/*.yaml and grades/*.yml (library.ts),
// so the copy ends in ".bak": "manha.yaml" is kept as "manha.2026-10-22.yaml.bak". To go back, drop the ".bak"
// and the date and keep "manha.yaml".

import { basename } from './paths';

/** The extension that keeps a backup from being read as a channel. */
export const BACKUP_EXTENSION = 'bak';

/** True for the name of a backup copy made by `gradeBackupName`. */
export function isGradeBackup(name: string): boolean {
  return /\.ya?ml\.bak$/i.test(basename(name));
}

/**
 * The file name for the backup of the grade `fileName` ("manha" or "manha.yaml") made on `date` ("YYYY-MM-DD"):
 * "manha.2026-10-22.yaml.bak", or "manha.2026-10-22-2.yaml.bak"... when that name is taken.
 * `taken` holds the file names (or paths) already in grades/, in any case.
 */
export function gradeBackupName(fileName: string, date: string, taken: Iterable<string>): string {
  const base = basename(fileName).replace(/\.ya?ml$/i, '');
  const used = new Set([...taken].map((entry) => basename(entry).toLowerCase()));
  for (let n = 1; ; n++) {
    const candidate = `${base}.${date}${n === 1 ? '' : `-${n}`}.yaml.${BACKUP_EXTENSION}`;
    if (!used.has(candidate.toLowerCase())) return candidate;
  }
}
