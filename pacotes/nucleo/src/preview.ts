// A preview of a channel's day for the schedule wizard: what airs, in which episode, at what time, laid out by the
// same engine the TV uses (planDay + buildTimeline with the channel's break rules). The days are laid out like
// `horario: real`, where each block starts at its time unless the one before ran over; so the times are the
// clock times a viewer would see, and a block that does not fit or a hole between blocks shows up as a warning.

import { formatTimeOfDay } from './dates';
import { DEFAULT_MAX_GAP_FILL, buildTimeline, planDay, requiredPaths, type PlannedItem } from './engine';
import { GUESS } from './generate';
import { isAiringDay } from './modes';
import { channelAdBreaks, type Settings } from './settings';
import type { Episode, Library, Schedule, Show } from './types';

export interface PreviewOptions {
  /** What the TV will obey: `interstitials`, `commercials` and `adBreaks` (the channel's own rules go over them). */
  settings: Pick<Settings, 'interstitials' | 'commercials' | 'adBreaks'>;
  /** Seconds, or undefined when the file's duration is not known (yet); a typical length stands in and the day is marked `estimated`. */
  durationOf: (path: string) => number | undefined;
}

export interface PreviewRow {
  /** Index of the block in the schedule. */
  block: number;
  /** Position (from 0) in its block of the schedule item that plays this episode. */
  item: number;
  /** Seconds since midnight when the episode starts (its first part, when breaks cut it). */
  start: number;
  /** When it ends (its last part). */
  end: number;
  show: Show;
  episode: Episode;
  episodeIndex: number;
}

export interface PreviewWarning {
  /** 'overlap': a block runs past the start of the next. 'gap': a hole longer than the engine fills. */
  kind: 'overlap' | 'gap';
  /** Index of the later block of the two. */
  block: number;
  /** How late the block starts, or how long the hole is. */
  seconds: number;
  message: string;
}

export interface PreviewBlock {
  /** The `horario` of the block. */
  start: number;
  /** When the first thing of the block really starts (later than `start` when the block before ran over); null for a block with nothing to air. */
  actualStart: number | null;
  end: number | null;
}

export interface DayPreview {
  date: string;
  /** False on a day off the schedule's `dias`: the preview is empty. */
  airs: boolean;
  rows: PreviewRow[];
  blocks: PreviewBlock[];
  warnings: PreviewWarning[];
  /** True when some video's duration was not known and a typical one was used: the times are guesses. */
  estimated: boolean;
  /** Every file whose duration the layout needs: load these, then ask again for a firmer answer. */
  paths: string[];
}

/** "2 h 10 min" / "25 min": a length in words, rounded to the minute. */
export function formatSpan(seconds: number): string {
  const minutes = Math.max(1, Math.round(seconds / 60));
  const hours = Math.floor(minutes / 60);
  if (hours === 0) return `${minutes} min`;
  return minutes % 60 === 0 ? `${hours} h` : `${hours} h ${minutes % 60} min`;
}

/** A start later than this many seconds counts as a block that runs over the next one. */
const OVERLAP_TOLERANCE = 60;

export function previewDay(schedule: Schedule, library: Library, date: string, options: PreviewOptions): DayPreview {
  const empty: DayPreview = { date, airs: false, rows: [], blocks: [], warnings: [], estimated: false, paths: [] };
  if (!isAiringDay(schedule, date)) return empty;

  const { settings } = options;
  const adBreaks = channelAdBreaks(settings, schedule);
  const plan = planDay(schedule, library, date, { interstitials: settings.interstitials, commercials: settings.commercials, bumpers: adBreaks.bumpers });
  const paths = requiredPaths(plan);

  const episodePaths = new Set<string>();
  for (const block of plan.blocks) for (const item of block.items) if (item.kind === 'episode') episodePaths.add(item.path);
  const commercials = new Set(plan.commercials);
  const bumpers = new Set([...plan.breakBumpers.entry, ...plan.breakBumpers.exit, ...plan.fillers]);
  const valid = (seconds: number | undefined): seconds is number => seconds !== undefined && Number.isFinite(seconds) && seconds > 0;
  const typical = (path: string) => (episodePaths.has(path) ? GUESS.episode : commercials.has(path) ? GUESS.commercial : bumpers.has(path) ? GUESS.bumper : GUESS.promo);
  const durationOf = (path: string) => {
    const known = options.durationOf(path);
    return valid(known) ? known : typical(path);
  };

  const timeline = buildTimeline(plan, durationOf, { keepLongGaps: true, adBreaks });
  const estimated = timeline.entries.some((entry) => entry.path !== undefined && !valid(options.durationOf(entry.path)));

  // Each episode, from the start of its first part to the end of its last one.
  const blockOf = new Map<PlannedItem, number>();
  plan.blocks.forEach((block, index) => block.items.forEach((item) => blockOf.set(item, index)));
  const spans = new Map<PlannedItem, { start: number; end: number }>();
  const blocks: PreviewBlock[] = plan.blocks.map((block) => ({ start: block.start, actualStart: null, end: null }));
  let current = -1;
  for (const entry of timeline.entries) {
    const index = entry.item ? blockOf.get(entry.item) : undefined;
    // A break belongs to the block of the episode before it; a filler or the static is between blocks.
    if (index !== undefined) current = index;
    else if (!entry.inBreak) continue;
    if (current < 0) continue;
    const block = blocks[current]!;
    block.actualStart ??= entry.start;
    block.end = Math.max(block.end ?? 0, entry.start + entry.duration);
    if (entry.item?.kind === 'episode' && index !== undefined) {
      const span = spans.get(entry.item);
      spans.set(entry.item, { start: span?.start ?? entry.start, end: entry.start + entry.duration });
    }
  }

  const rows: PreviewRow[] = [];
  for (const [item, span] of spans) {
    if (item.kind !== 'episode') continue;
    rows.push({ block: blockOf.get(item)!, item: item.itemIndex, start: span.start, end: span.end, show: item.show, episode: item.episode, episodeIndex: item.episodeIndex });
  }
  rows.sort((a, b) => a.start - b.start);

  const warnings: PreviewWarning[] = [];
  let before: PreviewBlock | undefined;
  blocks.forEach((block, index) => {
    if (block.actualStart === null) return;
    if (before?.end != null) {
      const late = block.actualStart - block.start;
      const hole = block.actualStart - before.end;
      if (late >= OVERLAP_TOLERANCE) {
        warnings.push({
          kind: 'overlap',
          block: index,
          seconds: late,
          message: `O horário das ${formatTimeOfDay(before.start)} passa do horário das ${formatTimeOfDay(block.start)}: o das ${formatTimeOfDay(block.start)} começa ${formatSpan(late)} atrasado, às ${formatTimeOfDay(block.actualStart)}.`,
        });
      } else if (hole > DEFAULT_MAX_GAP_FILL) {
        warnings.push({
          kind: 'gap',
          block: index,
          seconds: hole,
          message: `Das ${formatTimeOfDay(before.end)} às ${formatTimeOfDay(block.actualStart)} não passa nada (${formatSpan(hole)}): a TV só preenche buracos de até ${formatSpan(DEFAULT_MAX_GAP_FILL)}.`,
        });
      }
    }
    before = block;
  });

  return { date, airs: true, rows, blocks, warnings, estimated, paths };
}
