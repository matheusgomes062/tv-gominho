// The `agenda` of a schedule (docs/grade.md): episodes picked by hand for a date. A pick is an
// anchor: from there on the show continues with the episodes that follow it. The anchors of a
// schedule come from sources (the agenda, and the positions the app saves for each show),
// so the engine does not care where an anchor came from.

import { countDaysInSet, isoToDayNumber, mod, weekdayOf, type Weekday } from './dates';
import type { Library, Schedule, ScheduleItem, Show } from './types';

/**
 * "The show airs episode `episodeIndex` (an index in `Show.episodes`) at its `airing`-th appearance
 * of `date` (0-based, counting the show's items in the day's order), and continues from there."
 */
export interface Anchor {
  date: string;
  /** Show folder name, lowercased. */
  show: string;
  airing: number;
  episodeIndex: number;
  /**
   * How many consecutive airings are the episode itself rather than a starting point: an item with
   * `episodios: 2` pins both. Shows with `ordem: aleatoria` obey only the pinned airings.
   */
  pinned: number;
}

export type AnchorSource = (schedule: Schedule, library: Library) => Anchor[];

/**
 * Where anchors come from. Later sources win over earlier ones on the same airing, so a pick made by
 * hand always beats a position the app saved.
 */
const ANCHOR_SOURCES: readonly AnchorSource[] = [savedPositionAnchors, agendaAnchors];

/** Per show, how many times a day it airs, and the number of the first airing of each show item. */
export function showAirings(schedule: Schedule): { perDay: Map<string, number>; firstAiring: Map<ScheduleItem, number> } {
  const perDay = new Map<string, number>();
  const firstAiring = new Map<ScheduleItem, number>();
  for (const block of schedule.blocks) {
    for (const item of block.items) {
      if (item.type !== 'show') continue;
      const key = item.show.toLowerCase();
      firstAiring.set(item, perDay.get(key) ?? 0);
      perDay.set(key, (perDay.get(key) ?? 0) + item.count);
    }
  }
  return { perDay, firstAiring };
}

/** "12" -> "12", "012" -> "12", "temporada-02/5" -> "temporada-02/5"; null when it is neither. */
export function normalizeEpisodeRef(value: unknown): string | null {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  const match = /^(?:(.+)\/)?(\d+)$/.exec(String(value).trim());
  if (!match) return null;
  const number = String(parseInt(match[2]!, 10));
  const season = match[1]?.trim().replace(/^\/+|\/+$/g, '');
  return season ? `${season}/${number}` : number;
}

export type EpisodeLookup = { index: number } | { error: 'missing' | 'ambiguous' };

/**
 * The episode a reference (`normalizeEpisodeRef`) points at: the number in the file name, or
 * "<season folder>/<number>" when the show has seasons that repeat numbers (as in episodios.yaml).
 */
export function findEpisodeByRef(show: Show, ref: string): EpisodeLookup {
  const found = findEpisodesByRef(show, ref);
  if (found.length === 0) return { error: 'missing' };
  return found.length === 1 ? { index: found[0]! } : { error: 'ambiguous' };
}

/** Every episode a reference points at: more than one when seasons repeat the number and the reference has no season. */
export function findEpisodesByRef(show: Show, ref: string): number[] {
  const slash = ref.lastIndexOf('/');
  const season = slash >= 0 ? ref.slice(0, slash).toLowerCase() : null;
  const number = Number(slash >= 0 ? ref.slice(slash + 1) : ref);
  const found: number[] = [];
  show.episodes.forEach((episode, index) => {
    if (episode.number !== number) return;
    if (season !== null && (episode.season ?? '').toLowerCase() !== season) return;
    found.push(index);
  });
  return found;
}

function agendaAnchors(schedule: Schedule, library: Library): Anchor[] {
  const { firstAiring } = showAirings(schedule);
  const anchors: Anchor[] = [];
  for (const pick of schedule.agenda ?? []) {
    const item = schedule.blocks.find((block) => block.start === pick.blockStart)?.items[pick.item - 1];
    if (item?.type !== 'show') continue;
    const show = library.shows.find((candidate) => candidate.id.toLowerCase() === item.show.toLowerCase());
    if (!show) continue;
    const episode = findEpisodeByRef(show, pick.episode);
    if ('error' in episode) continue;
    anchors.push({ date: pick.date, show: item.show.toLowerCase(), airing: firstAiring.get(item)!, episodeIndex: episode.index, pinned: item.count });
  }
  return anchors;
}

/** A saved position (`posicoes`) is the show's first airing of the date. It pins nothing (`pinned: 0`): the show goes on from there, skipping a blocked episode. */
function savedPositionAnchors(schedule: Schedule, library: Library): Anchor[] {
  const anchors: Anchor[] = [];
  for (const position of schedule.positions ?? []) {
    const show = library.shows.find((candidate) => candidate.id.toLowerCase() === position.show.toLowerCase());
    if (!show) continue;
    const episode = findEpisodeByRef(show, position.episode);
    if ('error' in episode) continue;
    anchors.push({ date: position.date, show: position.show.toLowerCase(), airing: 0, episodeIndex: episode.index, pinned: 0 });
  }
  return anchors;
}

/**
 * Which episode a show airs at its `ordinal`-th airing (0 = the first one since `data_inicio`):
 * the latest anchor at or before it, plus the airings since, wrapping at the end of the show.
 * `allowed` are the episodes the dynamic mode may choose (ascending indices of `Show.episodes`; all of
 * them without a nao-passar.yaml): the count runs over those only, which is how blocked episodes are
 * skipped. An anchor from the agenda airs as it is, blocked or not (a saved position, which pins nothing, moves on to the next allowed one), and the airings after it go on with the allowed
 * episodes that follow it. Without anchors that is `allowed[ordinal]`, as it always was.
 * Null for a random show (`random`) that no pick pins: the engine draws one. Also null when nothing
 * is allowed and no pick pins the airing: the engine skips the item.
 */
export type EpisodeIndexOf = (show: string, ordinal: number, allowed: readonly number[], random: boolean) => number | null;

export function createEpisodeIndexOf(schedule: Schedule, library: Library, days: ReadonlySet<Weekday>): EpisodeIndexOf {
  const start = isoToDayNumber(schedule.startDate);
  const { perDay } = showAirings(schedule);

  interface Placed {
    ordinal: number;
    episodeIndex: number;
    pinned: number;
  }
  const byShow = new Map<string, Placed[]>();
  for (const source of ANCHOR_SOURCES) {
    for (const anchor of source(schedule, library)) {
      const day = isoToDayNumber(anchor.date);
      if (!days.has(weekdayOf(day))) continue;
      const ordinal = countDaysInSet(start, day, days) * (perDay.get(anchor.show) ?? 0) + anchor.airing;
      const list = byShow.get(anchor.show) ?? [];
      list.push({ ordinal, episodeIndex: anchor.episodeIndex, pinned: anchor.pinned });
      byShow.set(anchor.show, list);
    }
  }
  // Stable: on the same ordinal the anchor of the later source stays last, and wins.
  for (const list of byShow.values()) list.sort((a, b) => a.ordinal - b.ordinal);

  /**
   * The `since`-th airing after the anchor `episode` (0 = the anchor itself): the allowed episodes that follow it, wrapping.
   * A `soft` anchor (a saved position, `pinned: 0`) is not a choice: if it is blocked, it airs as the first allowed episode past it.
   */
  const after = (episode: number, since: number, allowed: readonly number[], soft: boolean): number | null => {
    if (since === 0 && !soft) return episode;
    if (allowed.length === 0) return null;
    const before = allowed.filter((index) => index < episode).length;
    // A blocked anchor is not in `allowed`: the first airing after it is the first allowed episode past it.
    return allowed[mod(before + since - (allowed.includes(episode) || soft ? 0 : 1), allowed.length)]!;
  };

  return (show, ordinal, allowed, random) => {
    let latest: Placed | undefined;
    for (const anchor of byShow.get(show) ?? []) if (anchor.ordinal <= ordinal) latest = anchor;
    const since = latest ? ordinal - latest.ordinal : 0;
    if (random) return latest && since < latest.pinned ? after(latest.episodeIndex, since, allowed, false) : null;
    if (latest) return after(latest.episodeIndex, since, allowed, latest.pinned === 0);
    return allowed.length > 0 ? allowed[mod(ordinal, allowed.length)]! : null;
  };
}
