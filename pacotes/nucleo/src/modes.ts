// The `horario` setting beyond 'continuous' (docs/configuracoes.md):
//   - real: follows the wall clock; blocks start at their time and the channel
//     is "fora do ar" when nothing is scheduled.
//   - fromStart: a marathon from the opening, ignoring the clock.
// Everything here is pure. The timelines are handed in by the caller (it knows
// how to read durations), so the same inputs always give the same answer.

import { dayNumberToIso, isoToDayNumber, weekdayOf, type Weekday } from './dates';
import { locate, scheduleDays, type Position, type Timeline } from './engine';
import type { Schedule } from './types';

const DAY_SECONDS = 86_400;

/**
 * How long after midnight we look at the previous day's timeline, in case its
 * last block ran past midnight (the 23:00 block that ends at 01:00).
 */
export const MAX_SPILLOVER = 6 * 3600;

/** Builds the timeline of an airing day. Called with "YYYY-MM-DD" dates. */
export type TimelineOf = (date: string) => Timeline | Promise<Timeline>;

/** True when the schedule airs on that day (`date` is "YYYY-MM-DD"). */
export function isAiringDay(schedule: Schedule, date: string): boolean {
  return scheduleDays(schedule).has(weekdayOf(isoToDayNumber(date)));
}

/** The airing day on or before `date`: where a day off takes its reruns from. */
export function airingDate(schedule: Schedule, date: string): string {
  const days = scheduleDays(schedule);
  let day = isoToDayNumber(date);
  while (!days.has(weekdayOf(day))) day--;
  return dayNumberToIso(day);
}

/** The first airing day after `date`. */
export function nextAiringDate(schedule: Schedule, date: string): string {
  const days = scheduleDays(schedule);
  let day = isoToDayNumber(date) + 1;
  while (!days.has(weekdayOf(day))) day++;
  return dayNumberToIso(day);
}

/** When a channel that is off the air comes back. */
export interface Resume {
  /** "YYYY-MM-DD" of the comeback. */
  date: string;
  weekday: Weekday;
  /** Seconds since midnight of `date`. */
  seconds: number;
  /** 0 = later today, 1 = tomorrow... counted from the day the question was asked on. */
  daysAhead: number;
}

/** A comeback at `seconds` after midnight of `from` (`seconds` may pass 86400); `daysAhead` counts from `from`. */
export function resumeAt(from: string, seconds: number): Resume {
  const extraDays = Math.floor(seconds / DAY_SECONDS);
  const day = isoToDayNumber(from) + extraDays;
  return {
    date: dayNumberToIso(day),
    weekday: weekdayOf(day),
    seconds: seconds - extraDays * DAY_SECONDS,
    daysAhead: extraDays,
  };
}

/**
 * The first moment the schedule is on air after `date` (that whole day is over
 * or off): the next airing day, at its first block. `daysAhead` counts from `date`.
 */
export function nextOnAir(schedule: Schedule, date: string): Resume {
  const next = nextAiringDate(schedule, date);
  const resume = resumeAt(next, schedule.blocks[0]?.start ?? 0);
  return { ...resume, daysAhead: isoToDayNumber(next) - isoToDayNumber(date) + resume.daysAhead };
}

export type RealPosition =
  | ({ offAir: false } & Position)
  /** `resumesAt`: when the next entry of this timeline starts, or null if the timeline is over. */
  | { offAir: true; resumesAt: number | null };

/**
 * What a real-clock channel shows at `secondsOfDay` of the timeline's day.
 * Unlike `locate`, the timeline does not loop and may have holes: between
 * blocks far apart, before the first one and after the last one the channel is
 * off the air. `secondsOfDay` may pass 86400 to look at a day's tail after midnight.
 */
export function locateReal(timeline: Timeline, secondsOfDay: number): RealPosition {
  const { entries } = timeline;
  // Last entry that has already started.
  let low = 0;
  let high = entries.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (entries[middle]!.start <= secondsOfDay) low = middle + 1;
    else high = middle;
  }
  const index = low - 1;
  if (index >= 0) {
    const entry = entries[index]!;
    if (secondsOfDay < entry.start + entry.duration) return { offAir: false, index, offset: secondsOfDay - entry.start };
  }
  return { offAir: true, resumesAt: entries[low]?.start ?? null };
}

export type RealTune =
  | {
      offAir: false;
      /** The airing day whose timeline is on: yesterday's while its tail runs past midnight. */
      date: string;
      timeline: Timeline;
      index: number;
      offset: number;
      /** Seconds to add to the clock of today to get the clock of `timeline` (86400 for yesterday's tail). */
      shift: number;
    }
  | {
      offAir: true;
      resume: Resume;
      /** 'dayOff': not an airing day; 'beforeStart': before the first block; 'gap': between blocks; 'ended': after the last item. */
      reason: 'dayOff' | 'beforeStart' | 'gap' | 'ended';
    };

/**
 * Decides what the channel shows at `secondsOfDay` of `date` in real-clock
 * mode. Order of the rules:
 *   1. Within `MAX_SPILLOVER` after midnight, the previous airing day's tail
 *      keeps playing until it ends (a block is never cut at midnight).
 *   2. Otherwise today's timeline applies, if today is an airing day. Blocks
 *      start at their time (a late block starts late, never cutting the one
 *      before), gaps longer than `maxGapFill` are off the air.
 *   3. Otherwise ("fora do ar"), the channel comes back at the next airing
 *      day's first block.
 * Returns null when today is an airing day but has nothing playable.
 * `timelineOf` must build timelines with `keepLongGaps: true`.
 */
export async function resolveReal(
  schedule: Schedule,
  date: string,
  secondsOfDay: number,
  timelineOf: TimelineOf,
): Promise<RealTune | null> {
  if (secondsOfDay < MAX_SPILLOVER) {
    const yesterday = dayNumberToIso(isoToDayNumber(date) - 1);
    if (isAiringDay(schedule, yesterday)) {
      const timeline = await timelineOf(yesterday);
      const position = locateReal(timeline, secondsOfDay + DAY_SECONDS);
      if (!position.offAir) {
        return { offAir: false, date: timeline.date, timeline, index: position.index, offset: position.offset, shift: DAY_SECONDS };
      }
    }
  }

  if (!isAiringDay(schedule, date)) return { offAir: true, resume: nextOnAir(schedule, date), reason: 'dayOff' };

  const timeline = await timelineOf(date);
  if (timeline.entries.length === 0) return null;
  const position = locateReal(timeline, secondsOfDay);
  if (!position.offAir) {
    return { offAir: false, date: timeline.date, timeline, index: position.index, offset: position.offset, shift: 0 };
  }
  if (position.resumesAt === null) return { offAir: true, resume: nextOnAir(schedule, date), reason: 'ended' };
  return {
    offAir: true,
    resume: resumeAt(date, position.resumesAt),
    reason: secondsOfDay < timeline.start ? 'beforeStart' : 'gap',
  };
}

export interface FromStartTune {
  /** The airing day whose timeline is playing. */
  date: string;
  timeline: Timeline;
  index: number;
  offset: number;
}

const MAX_MARATHON_DAYS = 5000;
const MAX_EMPTY_DAYS = 14;

/**
 * Where a marathon that started `elapsedSeconds` ago is. It starts at the
 * first item of the first block of `startDate` (or of the last airing day, if
 * that is a day off) and plays the timelines back to back, one airing day after
 * the other, so the episodes keep advancing. The clock and the gaps between
 * blocks are ignored (build the timelines with `maxGapFill: 0`).
 * Returns null when no airing day has anything playable.
 */
export async function resolveFromStart(
  schedule: Schedule,
  startDate: string,
  elapsedSeconds: number,
  timelineOf: TimelineOf,
): Promise<FromStartTune | null> {
  let date = airingDate(schedule, startDate);
  let remaining = Math.max(0, elapsedSeconds);
  let empty = 0;
  for (let days = 0; days < MAX_MARATHON_DAYS; days++) {
    const timeline = await timelineOf(date);
    const length = timeline.end - timeline.start;
    if (timeline.entries.length === 0 || length <= 0) {
      if (++empty >= MAX_EMPTY_DAYS) return null;
    } else {
      empty = 0;
      if (remaining < length) {
        const position = locate(timeline, timeline.start + remaining)!;
        return { date: timeline.date, timeline, index: position.index, offset: position.offset };
      }
      remaining -= length;
    }
    date = nextAiringDate(schedule, date);
  }
  return null;
}
