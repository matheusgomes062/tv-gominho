// Bumpers that frame a commercial break (docs/biblioteca.md, "Vinhetas de intervalo"):
// the "TV Globinho volta já" that goes in and the "estamos de volta" that comes back.
// They live in vinhetas/intervalos/, usually one subfolder per channel or brand, and
// a break only ever mixes files of ONE brand.

import { basename, fold, stripExtension } from './paths';
import type { Interstitial } from './types';

/** 'entry': going into the break. 'exit': coming back. 'any': generic, works in either position. */
export type BumperRole = 'entry' | 'exit' | 'any';

/**
 * The role a bumper's file name says: a word `entrada` is an entry, `saida`/`saída` an exit (ignoring
 * case and accents; digits and punctuation count as separators, so `entrada2` and `volta-saida` match).
 * Neither, or both, means generic.
 */
export function bumperRole(path: string): BumperRole {
  const words = new Set(fold(stripExtension(basename(path))).split(/[^a-z]+/));
  const entry = words.has('entrada');
  const exit = words.has('saida');
  if (entry === exit) return 'any';
  return entry ? 'entry' : 'exit';
}

/** The bumpers of one brand. */
export interface BumperGroup {
  /** The folder the files share: "intervalos/tv-globinho", or just "intervalos" for files with no subfolder. */
  id: string;
  items: Interstitial[];
}

/** Splits bumpers by brand: the first two folders of their path under vinhetas/ ("intervalos/tv-globinho"). */
export function groupBumpers(items: readonly Interstitial[]): BumperGroup[] {
  const groups = new Map<string, Interstitial[]>();
  for (const item of items) {
    const parts = item.relativePath.split('/');
    const id = (parts.length >= 3 ? parts.slice(0, 2) : parts.slice(0, 1)).join('/').toLowerCase();
    const list = groups.get(id);
    if (list) list.push(item);
    else groups.set(id, [item]);
  }
  return [...groups].map(([id, list]) => ({ id, items: list }));
}

/** What a day's breaks draw their bumpers from. Empty lists: no bumpers. */
export interface BreakBumpers {
  /** The brand chosen for the day ("intervalos/tv-globinho"); empty when there is none. */
  group: string;
  /** Candidates for the bumper that goes in: files tagged `entrada` and generic ones. */
  entry: string[];
  /** Candidates for the bumper that comes back: files tagged `saida` and generic ones. */
  exit: string[];
}

export const NO_BUMPERS: BreakBumpers = { group: '', entry: [], exit: [] };

/** The entry and exit candidates of one brand. */
export function bumpersOf(group: BumperGroup): BreakBumpers {
  const withRole = (wanted: BumperRole) =>
    group.items.filter((item) => {
      const role = bumperRole(item.path);
      return role === 'any' || role === wanted;
    }).map((item) => item.path);
  return { group: group.id, entry: withRole('entry'), exit: withRole('exit') };
}
