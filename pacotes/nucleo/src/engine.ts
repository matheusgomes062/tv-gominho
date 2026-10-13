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
import { findShow, resolveInterstitials } from './library';
import { createRng, hashString, pick, shuffled, type Rng } from './random';
import type { Episode, Library, Schedule, Show } from './types';

export interface PlanOptions {
  /** Play bumpers (vinhetas). Default true. */
  interstitials?: boolean;
  /** Play commercials. Default true. */
  commercials?: boolean;
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
  seed: number;
}

/** Decides which episodes and bumpers air on `date` ("YYYY-MM-DD"). */
export function planDay(schedule: Schedule, library: Library, date: string, options: PlanOptions = {}): DayPlan {
  const useInterstitials = options.interstitials ?? true;
  const useCommercials = (options.commercials ?? true) && useInterstitials;

  const days = new Set<Weekday>(schedule.days.length > 0 ? schedule.days : WEEKDAYS);
  const requested = isoToDayNumber(date);
  let airingDay = requested;
  while (!days.has(weekdayOf(airingDay))) airingDay--;

  const seed = hashString(`${schedule.id}|${dayNumberToIso(airingDay)}`);
  const rng = createRng(seed);

  // Each airing of a show advances one episode, counted from the premiere day.
  const airingsBefore = countDaysInSet(isoToDayNumber(schedule.startDate), airingDay, days);
  const perDay = new Map<string, number>();
  for (const block of schedule.blocks) {
    for (const item of block.items) {
      if (item.type === 'show') perDay.set(item.show.toLowerCase(), (perDay.get(item.show.toLowerCase()) ?? 0) + item.count);
    }
  }
  const counters = new Map<string, number>();
  for (const [show, count] of perDay) counters.set(show, airingsBefore * count);

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
          const episodeIndex =
            show.order === 'aleatoria'
              ? Math.floor(rng() * show.episodes.length)
              : mod(counter, show.episodes.length);
          const episode = show.episodes[episodeIndex]!;
          items.push({ kind: 'episode', path: episode.path, show, episode, episodeIndex });
        }
      } else if (item.type === 'interstitial') {
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

  const fillers = useInterstitials
    ? [
        ...resolveInterstitials(library, 'intervalos'),
        ...(useCommercials ? resolveInterstitials(library, 'comerciais') : []),
      ].map((item) => item.path)
    : [];

  return {
    scheduleId: schedule.id,
    requestedDate: date,
    date: dayNumberToIso(airingDay),
    blocks,
    fillers,
    seed,
  };
}

/** Every file whose duration `buildTimeline` needs. */
export function requiredPaths(plan: DayPlan): string[] {
  const paths = new Set<string>(plan.fillers);
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

  const firstStart = plan.blocks[0]?.start ?? 0;
  let t = firstStart;

  plan.blocks.forEach((block, i) => {
    if (i > 0) {
      const gap = block.start - t;
      // gap <= 0: the previous block ran late, so this one starts late (never cut an episode).
      // gap > maxGapFill: skip the dead air.
      if (gap > 0 && gap <= maxGapFill) t = fillGap(entries, t, gap, fillers, rng);
    }
    for (const item of block.items) {
      const duration = known(item.path);
      if (duration === undefined) continue;
      entries.push({ kind: item.kind, start: t, duration, path: item.path, item });
      t += duration;
    }
  });

  return { date: plan.date, entries, start: firstStart, end: t, skipped: [...skipped] };
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
