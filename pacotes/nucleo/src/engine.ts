// The schedule engine (docs/grade.md). Two steps:
//   1. planDay: decide WHAT plays on a given day (episodes, bumpers). Pure and
//      deterministic: no durations needed, so the UI knows which files to probe.
//   2. buildTimeline: decide WHEN, given the duration of each file.
// Then `locate` answers "what is on air right now, and how far into it?".

import {
  countDaysInSet,
  dayNumberToIso,
  isoToDayNumber,
  mod,
  weekdayOf,
  WEEKDAYS,
  type Weekday,
} from './dates';
import { createEpisodeIndexOf, showAirings } from './agenda';
import { bumpersOf, groupBumpers, NO_BUMPERS, type BreakBumpers } from './bumpers';
import { findShow, resolveInterstitials } from './library';
import { createRng, hashString, pick, shuffled, type Rng } from './random';
import type { AdBreakSettings } from './settings';
import type { Episode, Library, Schedule, Show } from './types';

export interface PlanOptions {
  /** Play bumpers (vinhetas), also as gap fillers. Default true. */
  interstitials?: boolean;
  /** Play commercials (vinhetas/comerciais), also as gap fillers. Independent of `interstitials`. Default true. */
  commercials?: boolean;
  /**
   * Bumpers that open and close each commercial break (vinhetas/intervalos/). Default true. They also need
   * `interstitials` and `commercials` (a break without commercials has nothing to frame).
   */
  bumpers?: boolean;
}

export type PlannedItem =
  | { kind: 'episode'; path: string; show: Show; episode: Episode; episodeIndex: number }
  | { kind: 'interstitial'; path: string; category: string };

export interface PlannedBlock {
  start: number;
  items: PlannedItem[];
}

export interface DayPlan {
  scheduleId: string;
  /** The day that was asked for. */
  requestedDate: string;
  /** The airing day actually used: on days off, the last airing day is rerun. */
  date: string;
  blocks: PlannedBlock[];
  /** Files that may fill short gaps between blocks. */
  fillers: string[];
  /** The commercials that commercial breaks (`buildTimeline`'s `adBreaks`) draw from: empty when commercials are off. */
  commercials: string[];
  /**
   * The bumpers that frame the breaks, all of one brand chosen for the day (see `bumpers.ts`):
   * empty when bumpers, commercials or vinhetas are off or the library has none.
   */
  breakBumpers: BreakBumpers;
  seed: number;
}

/** The weekdays a schedule airs on (all of them when `dias` is empty). */
export function scheduleDays(schedule: Schedule): Set<Weekday> {
  return new Set<Weekday>(schedule.days.length > 0 ? schedule.days : WEEKDAYS);
}

/** Decides which episodes and bumpers air on `date` ("YYYY-MM-DD"). */
export function planDay(schedule: Schedule, library: Library, date: string, options: PlanOptions = {}): DayPlan {
  const useInterstitials = options.interstitials ?? true;
  const useCommercials = options.commercials ?? true;
  const useBumpers = (options.bumpers ?? true) && useInterstitials && useCommercials;

  const days = scheduleDays(schedule);
  const requested = isoToDayNumber(date);
  let airingDay = requested;
  while (!days.has(weekdayOf(airingDay))) airingDay--;

  const seed = hashString(`${schedule.id}|${dayNumberToIso(airingDay)}`);
  const rng = createRng(seed);

  // Each airing of a show advances one episode, counted from the premiere day or from the latest
  // episode picked in the agenda (see agenda.ts).
  const airingsBefore = countDaysInSet(isoToDayNumber(schedule.startDate), airingDay, days);
  const episodeIndexOf = createEpisodeIndexOf(schedule, library, days);
  const counters = new Map<string, number>();
  for (const [show, count] of showAirings(schedule).perDay) counters.set(show, airingsBefore * count);

  const blocks: PlannedBlock[] = schedule.blocks.map((block) => {
    const items: PlannedItem[] = [];
    for (const item of block.items) {
      if (item.type === 'show') {
        const show = findShow(library, item.show);
        const key = item.show.toLowerCase();
        for (let i = 0; i < item.count; i++) {
          const counter = counters.get(key) ?? 0;
          counters.set(key, counter + 1);
          if (!show || show.episodes.length === 0) continue;
          const random = show.order === 'aleatoria';
          // A random show always draws, even when a pick decides, so the day's other draws don't change.
          const drawn = random ? Math.floor(rng() * show.episodes.length) : 0;
          const episodeIndex = episodeIndexOf(key, counter, show.episodes.length, random) ?? drawn;
          const episode = show.episodes[episodeIndex]!;
          items.push({ kind: 'episode', path: episode.path, show, episode, episodeIndex });
        }
      } else if (item.type === 'interstitial') {
        // Always draw, even when switched off, so the other picks of the day don't change.
        const choice = pick(rng, resolveInterstitials(library, item.ref));
        if (useInterstitials && choice) {
          items.push({ kind: 'interstitial', path: choice.path, category: choice.category });
        }
      } else {
        const commercials = resolveInterstitials(library, 'comerciais');
        const order = shuffled(rng, commercials);
        if (useCommercials && order.length > 0) {
          for (let i = 0; i < item.count; i++) {
            const choice = order[i % order.length]!;
            items.push({ kind: 'interstitial', path: choice.path, category: choice.category });
          }
        }
      }
    }
    return { start: block.start, items };
  });

  const commercialPaths = useCommercials ? resolveInterstitials(library, 'comerciais').map((item) => item.path) : [];
  const fillers = [
    ...(useInterstitials ? resolveInterstitials(library, 'intervalos').map((item) => item.path) : []),
    ...commercialPaths,
  ];

  return {
    scheduleId: schedule.id,
    requestedDate: date,
    date: dayNumberToIso(airingDay),
    blocks,
    fillers,
    commercials: commercialPaths,
    breakBumpers: useBumpers && commercialPaths.length > 0 ? chooseBreakBumpers(schedule, library, seed) : NO_BUMPERS,
    seed,
  };
}

/**
 * The brand whose bumpers frame every break of the day: the schedule's `vinhetas_intervalo` (or all of
 * vinhetas/intervalos/ without it) split by subfolder, one subfolder drawn with the day's seed. A separate
 * random stream, so the other picks of the day are the same with or without bumpers.
 */
function chooseBreakBumpers(schedule: Schedule, library: Library, seed: number): BreakBumpers {
  const fromSchedule = schedule.breakBumpersRef ? resolveInterstitials(library, schedule.breakBumpersRef) : [];
  const groups = groupBumpers(fromSchedule.length > 0 ? fromSchedule : resolveInterstitials(library, 'intervalos'));
  const group = pick(createRng(seed ^ 0x2c1b3c6d), groups);
  return group ? bumpersOf(group) : NO_BUMPERS;
}

/** Every file whose duration `buildTimeline` needs. */
export function requiredPaths(plan: DayPlan): string[] {
  const paths = new Set<string>([...plan.fillers, ...plan.commercials, ...plan.breakBumpers.entry, ...plan.breakBumpers.exit]);
  for (const block of plan.blocks) for (const item of block.items) paths.add(item.path);
  return [...paths];
}

export type TimelineKind = 'episode' | 'interstitial' | 'filler' | 'idle';

export interface TimelineEntry {
  kind: TimelineKind;
  /** Seconds since midnight (may pass 86400 when the day runs long). */
  start: number;
  duration: number;
  /** Missing only for 'idle' (off-air static). */
  path?: string;
  item?: PlannedItem;
  /**
   * Seconds into `path` where this entry starts (default 0). Only episodes cut
   * by a commercial break have it: the part after the break starts mid-file.
   * `duration` is the length of this part alone. See `filePosition`.
   */
  fileOffset?: number;
  /** Set when the episode is cut by commercial breaks: this entry is part `index` of `count` (1-based). */
  part?: { index: number; count: number };
  /** True for what a commercial break is made of: its commercials and the bumpers around them (as opposed to items the schedule asked for, or gap fillers). */
  inBreak?: boolean;
}

export interface Timeline {
  date: string;
  entries: TimelineEntry[];
  start: number;
  end: number;
  /** Files skipped because their duration is unknown (unreadable video). */
  skipped: string[];
}

export interface TimelineOptions {
  /**
   * Gaps between blocks up to this many seconds are filled with bumpers and
   * commercials. Longer gaps are skipped: the next block starts right away,
   * so the channel is always on air. Default: 10 minutes.
   */
  maxGapFill?: number;
  /**
   * Keep gaps longer than `maxGapFill` as holes in the timeline (the next block
   * starts at its own time, nothing is on air in between) instead of skipping
   * them. Used by `horario: real`. Default false.
   */
  keepLongGaps?: boolean;
  /**
   * Commercial breaks: inside episodes and after them (docs/grade.md). Needs
   * `plan.commercials` (the `commercials` option of `planDay`); the bumpers around
   * them need `plan.breakBumpers` and `adBreaks.bumpers`. Absent: episodes
   * play whole, with no automatic breaks.
   */
  adBreaks?: AdBreakSettings;
}

/** Shortest stretch of episode between the start (or end) and an automatic break, in seconds. */
export const MIN_ACT_SECONDS = 120;

/**
 * Where the commercial breaks cut an episode of `duration` seconds, as
 * seconds from its start. `every` is the setting in minutes (0 = no breaks).
 *   - `override` (the episode's own `intervalos`): exactly those points, dropping the ones outside the episode.
 *   - otherwise n = floor(duration / every) breaks, but none when the episode is shorter than
 *     every + 2 minutes, spread evenly (acts of duration / (n + 1)), and never so many that an
 *     act gets shorter than 2 minutes: nothing within 2 minutes of the start or the end.
 */
export function breakPoints(duration: number, every: number, override?: readonly number[]): number[] {
  if (!(every > 0) || !(duration > 0)) return [];
  if (override && override.length > 0) {
    return [...new Set(override)].filter((point) => point >= 1 && point <= duration - 1).sort((a, b) => a - b);
  }
  const act = every * 60;
  if (duration < act + MIN_ACT_SECONDS) return [];
  const count = Math.min(Math.floor(duration / act), Math.floor(duration / MIN_ACT_SECONDS) - 1);
  return Array.from({ length: Math.max(0, count) }, (_, k) => Math.round((duration * (k + 1) * 1000) / (count + 1)) / 1000);
}

/** The file and the time in it for `offset` seconds into `entry` (an episode part starts mid-file). */
export function filePosition(entry: TimelineEntry, offset: number): { path: string | undefined; time: number } {
  return { path: entry.path, time: (entry.fileOffset ?? 0) + offset };
}

/** Lays out a day plan in time. `durationOf` returns seconds, or undefined if unknown. */
export function buildTimeline(
  plan: DayPlan,
  durationOf: (path: string) => number | undefined,
  options: TimelineOptions = {},
): Timeline {
  const maxGapFill = options.maxGapFill ?? 600;
  const entries: TimelineEntry[] = [];
  const skipped = new Set<string>();
  const known = (path: string) => {
    const duration = durationOf(path);
    if (duration !== undefined && Number.isFinite(duration) && duration > 0) return duration;
    skipped.add(path);
    return undefined;
  };
  const fillers = plan.fillers
    .map((path) => ({ path, duration: durationOf(path) }))
    .filter((f): f is { path: string; duration: number } => f.duration !== undefined && Number.isFinite(f.duration) && f.duration > 0);
  const rng = createRng(plan.seed ^ 0x9e3779b9);

  // Commercial breaks have their own random stream, so gap filling does not depend on them.
  const adBreaks = options.adBreaks;
  const ads = adBreaks
    ? plan.commercials
        .map((path) => ({ path, duration: durationOf(path) }))
        .filter((ad): ad is { path: string; duration: number } => ad.duration !== undefined && Number.isFinite(ad.duration) && ad.duration > 0)
    : [];
  const breaksOn = adBreaks !== undefined && ads.length > 0;
  const breakRng = createRng(plan.seed ^ 0x7f4a7c15);
  let lastBreak: string[] = [];

  // Bumpers framing each break: their own random stream too, so the commercials picked do not depend on them.
  const usable = (paths: readonly string[]) =>
    paths
      .map((path) => ({ path, duration: durationOf(path) }))
      .filter((b): b is { path: string; duration: number } => b.duration !== undefined && Number.isFinite(b.duration) && b.duration > 0);
  const bumperRng = createRng(plan.seed ^ 0x5bd1e995);
  const entryBumpers = breaksOn && adBreaks.bumpers ? usable(plan.breakBumpers.entry) : [];
  const exitBumpers = breaksOn && adBreaks.bumpers ? usable(plan.breakBumpers.exit) : [];
  const bumperCategory = plan.breakBumpers.group.split('/')[0] || 'intervalos';
  let lastEntry: string | undefined;
  let lastExit: string | undefined;

  const firstStart = plan.blocks[0]?.start ?? 0;
  let t = firstStart;

  plan.blocks.forEach((block, i) => {
    if (i > 0) {
      const gap = block.start - t;
      // gap <= 0: the previous block ran late, so this one starts late (never cut an episode).
      // gap > maxGapFill: skip the dead air.
      if (gap > 0 && gap <= maxGapFill) t = fillGap(entries, t, gap, fillers, rng);
      else if (gap > maxGapFill && options.keepLongGaps) t = block.start;
    }
    const addInBreak = (file: { path: string; duration: number }, category: string) => {
      const planned: PlannedItem = { kind: 'interstitial', path: file.path, category };
      entries.push({ kind: 'interstitial', start: t, duration: file.duration, path: file.path, item: planned, inBreak: true });
      t += file.duration;
    };
    /**
     * A commercial break: a bumper going in, `adBreaks.ads` commercials (not repeating the previous break's if
     * there are others), a bumper coming back. A side without bumpers just has none.
     */
    const addBreak = () => {
      const chosen = pickBreakAds(ads, adBreaks!.ads, lastBreak, breakRng);
      lastBreak = chosen.map((ad) => ad.path);
      const entry = pickBumper(entryBumpers, [[lastEntry]], bumperRng);
      if (entry) {
        addInBreak(entry, bumperCategory);
        lastEntry = entry.path;
      }
      for (const ad of chosen) addInBreak(ad, 'comerciais');
      const exit = pickBumper(exitBumpers, [[lastExit, entry?.path], [entry?.path], [lastExit]], bumperRng);
      if (exit) {
        addInBreak(exit, bumperCategory);
        lastExit = exit.path;
      }
    };

    block.items.forEach((item, k) => {
      const duration = known(item.path);
      if (duration === undefined) return;
      if (!breaksOn || item.kind !== 'episode') {
        entries.push({ kind: item.kind, start: t, duration, path: item.path, item });
        t += duration;
        return;
      }

      const cuts = breakPoints(duration, adBreaks!.every, item.episode.breaks);
      const bounds = [0, ...cuts, duration];
      for (let p = 0; p < bounds.length - 1; p++) {
        const length = bounds[p + 1]! - bounds[p]!;
        const entry: TimelineEntry = { kind: 'episode', start: t, duration: length, path: item.path, item };
        if (cuts.length > 0) {
          entry.fileOffset = bounds[p];
          entry.part = { index: p + 1, count: bounds.length - 1 };
        }
        entries.push(entry);
        t += length;
        if (p < cuts.length) addBreak();
      }
      // After the episode, unless the schedule already puts commercials right there.
      const next = block.items[k + 1] ?? plan.blocks[i + 1]?.items[0];
      const scheduled = next?.kind === 'interstitial' && next.category === 'comerciais';
      if (adBreaks!.afterEpisode && !scheduled) addBreak();
    });
  });

  return { date: plan.date, entries, start: firstStart, end: t, skipped: [...skipped] };
}

/** `count` commercials for one break: the ones not in `previous` first, no ad twice in a row (unless there is only one). */
function pickBreakAds(
  ads: readonly { path: string; duration: number }[],
  count: number,
  previous: readonly string[],
  rng: Rng,
): { path: string; duration: number }[] {
  const order = shuffled(rng, ads);
  const fresh = order.filter((ad) => !previous.includes(ad.path));
  const cycle = [...fresh, ...order.filter((ad) => previous.includes(ad.path))];
  // Not the same commercial as the last one of the previous break.
  if (cycle.length > 1 && cycle[0]!.path === previous.at(-1)) cycle.push(cycle.shift()!);
  return Array.from({ length: count }, (_, i) => cycle[i % cycle.length]!);
}

/** A bumper that is none of the first list of `avoid` that leaves anything, or any of them when no list does. */
function pickBumper(
  candidates: readonly { path: string; duration: number }[],
  avoid: readonly (readonly (string | undefined)[])[],
  rng: Rng,
): { path: string; duration: number } | undefined {
  for (const paths of avoid) {
    const fresh = candidates.filter((bumper) => !paths.includes(bumper.path));
    if (fresh.length > 0) return pick(rng, fresh);
  }
  return pick(rng, candidates);
}

function fillGap(
  entries: TimelineEntry[],
  start: number,
  gap: number,
  fillers: { path: string; duration: number }[],
  rng: Rng,
): number {
  let t = start;
  let remaining = gap;
  let last: string | undefined;
  for (let guard = 0; guard < 1000 && remaining >= 1; guard++) {
    const fits = fillers.filter((f) => f.duration <= remaining);
    const choice = pick(rng, fits.length > 1 ? fits.filter((f) => f.path !== last) : fits);
    if (!choice) break;
    entries.push({ kind: 'filler', start: t, duration: choice.duration, path: choice.path });
    t += choice.duration;
    remaining -= choice.duration;
    last = choice.path;
  }
  if (remaining >= 1) {
    entries.push({ kind: 'idle', start: t, duration: remaining });
  }
  return start + gap;
}

export interface Position {
  index: number;
  /** Seconds into the entry. */
  offset: number;
}

/**
 * What is on air at `secondsOfDay` in continuous mode: the day's timeline
 * repeats back to back, so something is always playing.
 */
export function locate(timeline: Timeline, secondsOfDay: number): Position | null {
  const length = timeline.end - timeline.start;
  if (timeline.entries.length === 0 || length <= 0) return null;
  const position = timeline.start + mod(secondsOfDay - timeline.start, length);

  let low = 0;
  let high = timeline.entries.length - 1;
  while (low < high) {
    const middle = (low + high) >> 1;
    const entry = timeline.entries[middle]!;
    if (entry.start + entry.duration <= position) low = middle + 1;
    else high = middle;
  }
  const entry = timeline.entries[low]!;
  return { index: low, offset: Math.max(0, position - entry.start) };
}
