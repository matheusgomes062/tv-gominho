// The `agenda` of a schedule (docs/grade.md): episodes picked by hand for a date. A pick is an
// anchor: from there on the show continues with the episodes that follow it. The anchors of a
// schedule come from sources (today only the agenda; a saved position per show would be another),
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
const ANCHOR_SOURCES: readonly AnchorSource[] = [agendaAnchors];

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
  const slash = ref.lastIndexOf('/');
  const season = slash >= 0 ? ref.slice(0, slash).toLowerCase() : null;
  const number = Number(slash >= 0 ? ref.slice(slash + 1) : ref);
  const found: number[] = [];
  show.episodes.forEach((episode, index) => {
    if (episode.number !== number) return;
    if (season !== null && (episode.season ?? '').toLowerCase() !== season) return;
    found.push(index);
  });
  if (found.length === 0) return { error: 'missing' };
  return found.length === 1 ? { index: found[0]! } : { error: 'ambiguous' };
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

/**
 * Which episode a show airs at its `ordinal`-th airing (0 = the first one since `data_inicio`):
 * the latest anchor at or before it, plus the airings since, wrapping at the end of the show.
 * Without anchors that is `ordinal` itself, as it always was. Null for a random show
 * (`random`) that no pick pins: the engine draws one.
 */
export type EpisodeIndexOf = (show: string, ordinal: number, episodes: number, random: boolean) => number | null;

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

  return (show, ordinal, episodes, random) => {
    let latest: Placed | undefined;
    for (const anchor of byShow.get(show) ?? []) if (anchor.ordinal <= ordinal) latest = anchor;
    const since = latest ? ordinal - latest.ordinal : 0;
    if (random) return latest && since < latest.pinned ? mod(latest.episodeIndex + since, episodes) : null;
    return mod(latest ? latest.episodeIndex + since : ordinal, episodes);
  };
}
