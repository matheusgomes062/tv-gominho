import { DEFAULT_MAX_GAP_FILL, formatSpan, formatTimeOfDay } from '@tv-gominho/nucleo';
import type { Airing, WeekModel } from './week-model';

// The guide of a week, the way the cable TV guides of the 90s drew it: time runs across in half hour slots, one row
// per day, and every episode is a block as wide as it plays. This is the model behind components/Guide.tsx: the
// rows and the blocks (from the week of week-model.ts), where the focus goes for each arrow, and which part of the
// day the screen shows. No React or DOM in here, so it is all testable (see guide-model.test.ts).

/** One slot of the time axis: half an hour. */
export const SLOT = 30 * 60;
export const DAY_SECONDS = 24 * 3600;
export const DAY_SLOTS = DAY_SECONDS / SLOT;
/** How many slots the screen shows at once: two hours. */
export const WINDOW_SLOTS = 4;
export const WINDOW_SECONDS = WINDOW_SLOTS * SLOT;
/** A block shorter than this is drawn as long as this, so it can still be seen. */
const MIN_BLOCK = 60;

export interface GuideBlock {
  airing: Airing;
  /** The row it is in, and its place in it (from 0, in time order). */
  row: number;
  index: number;
  /** Seconds since midnight. */
  start: number;
  end: number;
}

/** A hole between two blocks of a day that is short enough for the TV to fill: the commercial break. */
export interface GuideBreak {
  start: number;
  end: number;
}

/** What a row says when it has no blocks. */
export type RowState = 'airs' | 'off' | 'before-start' | 'empty';

export interface GuideRow {
  date: string;
  /** "Qua 22/10". */
  label: string;
  today: boolean;
  state: RowState;
  blocks: GuideBlock[];
  breaks: GuideBreak[];
}

export interface Guide {
  rows: GuideRow[];
}

/** The block in focus, and the moment of the day Up and Down aim at (so Up then Down comes back to the same block). */
export interface GuideFocus {
  row: number;
  index: number;
  time: number;
}

export type Move = 'left' | 'right' | 'up' | 'down';

// ---------------------------------------------------------------- the rows

/** The guide of a week: a row per day, and in each row a block per episode, from where it starts to where it ends. */
export function buildGuide(week: WeekModel): Guide {
  const rows = week.days.map((day, row): GuideRow => {
    const state: RowState = day.beforeStart ? 'before-start' : !day.airs ? 'off' : day.airings.length === 0 ? 'empty' : 'airs';
    const blocks = day.airings
      .map((airing) => ({ airing, start: airing.start, end: Math.max(airing.end, airing.start + MIN_BLOCK) }))
      .sort((a, b) => a.start - b.start)
      .map((block, index): GuideBlock => ({ ...block, row, index }));
    // One block never covers the start of the next.
    for (let i = 0; i + 1 < blocks.length; i++) blocks[i]!.end = Math.min(blocks[i]!.end, blocks[i + 1]!.start);
    const breaks: GuideBreak[] = [];
    for (let i = 0; i + 1 < blocks.length; i++) {
      const hole = blocks[i + 1]!.start - blocks[i]!.end;
      if (hole > 0 && hole <= DEFAULT_MAX_GAP_FILL) breaks.push({ start: blocks[i]!.end, end: blocks[i + 1]!.start });
    }
    return { date: day.date, label: day.label, today: day.today, state, blocks, breaks };
  });
  return { rows };
}

/** The index of the block of `row` that plays at `time`, or the nearest one when none does; -1 for a row with no blocks. */
export function blockAt(row: GuideRow, time: number): number {
  let best = -1;
  let distance = Infinity;
  for (const block of row.blocks) {
    const gap = time < block.start ? block.start - time : time >= block.end ? time - block.end + 1 : 0;
    if (gap < distance) {
      best = block.index;
      distance = gap;
    }
  }
  return best;
}

// ---------------------------------------------------------------- the focus

/** Where the focus starts: what plays on today's row now (or comes next); otherwise the first block of the first day with one. */
export function initialFocus(guide: Guide, now: number | null): GuideFocus | null {
  const today = guide.rows.findIndex((row) => row.today && row.blocks.length > 0);
  if (today >= 0 && now !== null) {
    const row = guide.rows[today]!;
    const playing = row.blocks.find((block) => now < block.end);
    const block = playing ?? row.blocks[row.blocks.length - 1]!;
    return { row: today, index: block.index, time: block.start };
  }
  const first = today >= 0 ? today : guide.rows.findIndex((row) => row.blocks.length > 0);
  if (first < 0) return null;
  return { row: first, index: 0, time: guide.rows[first]!.blocks[0]!.start };
}

/** The focus after an arrow, or null when there is nowhere to go that way (the arrow is then free to leave the guide). */
export function moveFocus(guide: Guide, focus: GuideFocus, move: Move): GuideFocus | null {
  const row = guide.rows[focus.row];
  if (!row) return null;
  if (move === 'left' || move === 'right') {
    const next = row.blocks[focus.index + (move === 'left' ? -1 : 1)];
    return next ? { row: focus.row, index: next.index, time: next.start } : null;
  }
  // Up and Down skip the days with nothing on them.
  const step = move === 'up' ? -1 : 1;
  for (let r = focus.row + step; r >= 0 && r < guide.rows.length; r += step) {
    const index = blockAt(guide.rows[r]!, focus.time);
    if (index >= 0) return { row: r, index, time: focus.time };
  }
  return null;
}

/** The block the focus is on. */
export function focusedBlock(guide: Guide, focus: GuideFocus | null): GuideBlock | null {
  return (focus && guide.rows[focus.row]?.blocks[focus.index]) || null;
}

/** The focus back on the block that has this airing (the week was built again), or the first one that can have it. */
export function refocus(guide: Guide, focus: GuideFocus | null): GuideFocus | null {
  if (!focus) return null;
  const row = guide.rows[focus.row];
  if (row && row.blocks.length > 0) {
    const index = blockAt(row, focus.time);
    if (index >= 0) return { row: focus.row, index, time: focus.time };
  }
  return initialFocus(guide, null);
}

// ---------------------------------------------------------------- the part of the day on screen

const floorSlot = (seconds: number) => Math.floor(seconds / SLOT) * SLOT;
const ceilSlot = (seconds: number) => Math.ceil(seconds / SLOT) * SLOT;
const clampWindow = (start: number) => Math.min(Math.max(start, 0), DAY_SECONDS - WINDOW_SECONDS);

/** Where the window starts (seconds, a whole slot) to show `block`, with a slot of what comes before it. */
export function windowFor(block: GuideBlock | null): number {
  return block ? clampWindow(floorSlot(block.start) - SLOT) : clampWindow(8 * 3600);
}

/**
 * The window after the focus moved to `block`: where it was when the block is all in it; otherwise moved just enough to
 * show it (a block longer than the window shows its start).
 */
export function scrollWindow(start: number, block: GuideBlock): number {
  const end = start + WINDOW_SECONDS;
  if (block.start >= start && block.end <= end) return start;
  if (block.start < start) return clampWindow(floorSlot(block.start) - SLOT);
  // Longer than the window and already starting in it: nothing more to show by moving.
  if (block.end - block.start >= WINDOW_SECONDS && block.start < end) return start;
  // Past the right edge: bring its end in, but never push its start out of sight.
  return clampWindow(Math.min(ceilSlot(block.end) - WINDOW_SECONDS, floorSlot(block.start)));
}

/** The labels of the time axis: one per slot of the day, "08:30". */
export function slotLabels(): Array<{ seconds: number; label: string; hour: boolean }> {
  return Array.from({ length: DAY_SLOTS }, (_, slot) => ({ seconds: slot * SLOT, label: formatTimeOfDay(slot * SLOT), hour: slot % 2 === 0 }));
}

/** Where a time is on the day, as a fraction (0 to 1): what the track of the day is drawn from. */
export const dayFraction = (seconds: number) => Math.min(Math.max(seconds / DAY_SECONDS, 0), 1);

// ---------------------------------------------------------------- the details strip

export interface BlockDetails {
  show: string;
  /** "Ep. 3 · A Ilha" or just "Ep. 3". */
  episode: string;
  /** "08:00–08:22". */
  span: string;
  /** "22 min". */
  length: string;
  pinned: boolean;
  blocked: boolean;
  /** OK opens the choice of the episode. */
  editable: boolean;
}

/** What the strip at the top of the guide says about the block in focus. */
export function blockDetails(block: GuideBlock): BlockDetails {
  const { airing } = block;
  return {
    show: airing.showTitle,
    episode: airing.title ? `${airing.label} · ${airing.title}` : airing.label,
    span: `${formatTimeOfDay(block.start)}–${formatTimeOfDay(block.end)}`,
    length: formatSpan(block.end - block.start),
    pinned: airing.pinned,
    blocked: airing.blocked,
    editable: airing.editable,
  };
}

/** What a screen reader hears for a block. */
export function blockSpeech(block: GuideBlock, today: boolean): string {
  const d = blockDetails(block);
  return `${d.show}, ${d.episode}, ${d.span}${today ? ', hoje' : ''}${d.pinned ? '. Fixo' : ''}${d.blocked ? '. Está em “não passar”' : ''}`;
}

/** What an empty row says. */
export const ROW_TEXT: Record<Exclude<RowState, 'airs'>, string> = {
  off: 'fora do ar',
  'before-start': 'ainda não começou',
  empty: 'nada passa',
};
