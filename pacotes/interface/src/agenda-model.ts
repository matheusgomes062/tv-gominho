import {
  blockedEpisodes,
  dayNumberToIso,
  episodeRef,
  findEpisodeByRef,
  findShow,
  isoToDayNumber,
  planDay,
  weekdayOf,
  type AgendaPick,
  type Library,
  type Schedule,
  type Weekday,
} from '@tv-gominho/nucleo';
import {
  MAX_COUNT,
  checkEditor,
  parseTime,
  prepareSave,
  settleBlocks,
  type EditorBlock,
  type EditorPick,
  type EditorState,
} from './editor-model';

// The model of the "Agenda" tab of the channel editor: a week of the grade (the airing days, one row per show
// item of the blocks) with the episode the TV will play in each cell, and the picks that pin a cell to an
// episode. The prediction is the TV engine itself (planDay) run on the grade the editor describes right now,
// saved or not, so what the cell says is what the TV plays after saving. No React or DOM in here, so it is all
// testable (see agenda-model.test.ts); AgendaWeek.tsx only draws it.
//
// The picks live in the editor state (`EditorState.picks`), where they follow their items when blocks move.

/** Monday first, the way a Brazilian week is read. */
const MONDAY_FIRST: readonly Weekday[] = ['seg', 'ter', 'qua', 'qui', 'sex', 'sab', 'dom'];

/** A show item of a block: one row of the week. */
export interface AgendaRow {
  /** `EditorItem.key`: what a pick is tied to. */
  itemKey: number;
  blockKey: number;
  /** "08:00": when the block starts. */
  blockTime: string;
  /** Seconds since midnight. */
  blockStart: number;
  /** The show as written in the grade. */
  show: string;
  /** The title of the show in the library, or the name as written when the library does not have it. */
  showTitle: string;
  /** How many episodes the item plays (`episodios: N`). */
  count: number;
}

/** An episode of the library as a cell shows it. */
export interface CellEpisode {
  /** Index in `Show.episodes`. */
  index: number;
  number: number | null;
  season: string | null;
  title: string;
  /** The "não passar" list holds it: only a pick makes it air. */
  blocked: boolean;
}

export interface AgendaCell {
  date: string;
  itemKey: number;
  /** What the TV plays in this space, in order: up to `count` episodes. Empty: nothing airs here. */
  episodes: CellEpisode[];
  /** How many more episodes the item plays after the first one (`episodios: N`): "+1". */
  more: number;
  /** An episode picked by hand for this cell, and whether the library still has it. */
  pick: { episode: string; found: boolean } | null;
  /** The show draws its episodes (`ordem: aleatoria`) and no pick decides this cell. */
  drawn: boolean;
  /** Why nothing airs, when `episodes` is empty. */
  empty?: 'missing' | 'blocked' | 'before-start';
  /** Whether a pick can be made or reset here: only from today on, and from the premiere of the grade. */
  editable: boolean;
}

export interface WeekGrid {
  /** The Monday of the week. */
  weekStart: string;
  /** The airing days of the week, in order (days outside `dias` are not here). */
  dates: string[];
  rows: AgendaRow[];
  /** `cells[row][day]`, matching `rows` and `dates`. */
  cells: AgendaCell[][];
}

// ---------------------------------------------------------------- weeks

/** The Monday on or before `date` ("YYYY-MM-DD"). */
export function weekStartOf(date: string): string {
  const day = isoToDayNumber(date);
  return dayNumberToIso(day - MONDAY_FIRST.indexOf(weekdayOf(day)));
}

/** The Monday `weeks` weeks after (negative: before) the Monday `weekStart`. */
export function shiftWeek(weekStart: string, weeks: number): string {
  return dayNumberToIso(isoToDayNumber(weekStart) + weeks * 7);
}

/** The days of the week of `weekStart` that the grade airs on, in order. */
export function airingDates(weekStart: string, days: readonly Weekday[]): string[] {
  const first = isoToDayNumber(weekStart);
  const dates: string[] = [];
  for (let offset = 0; offset < 7; offset++) {
    if (days.includes(weekdayOf(first + offset))) dates.push(dayNumberToIso(first + offset));
  }
  return dates;
}

// ---------------------------------------------------------------- the grade as it airs

/**
 * The editor state cleaned of what cannot be saved yet (a block with a bad or repeated time, an item with a quantity
 * that is not a number, no days...), so the week can still be shown while the other parts are being fixed. What is
 * valid is untouched. Null when nothing valid is left.
 */
function usable(state: EditorState): EditorState | null {
  const taken = new Set<number>();
  const blocks: EditorBlock[] = [];
  for (const block of settleBlocks(state).blocks) {
    const start = parseTime(block.time);
    if (start === null || taken.has(start)) continue;
    taken.add(start);
    const items = block.items.filter((item) => {
      if (item.type === 'interstitial') return item.ref.trim() !== '';
      if (!Number.isInteger(item.count) || item.count < 1 || item.count > MAX_COUNT) return false;
      return item.type !== 'show' || item.show.trim() !== '';
    });
    if (items.length > 0) blocks.push({ ...block, items });
  }
  // Name and description play no part in what airs.
  const next: EditorState = { ...state, name: 'canal', description: '', blocks };
  return blocks.length > 0 && state.days.length > 0 && checkEditor(next).errors.length === 0 ? next : null;
}

/**
 * The Schedule the TV would play after saving the state as it is (with the saved positions `prepareSave` adds when
 * the edit changes what airs), or null when nothing in it is usable yet. `today` is "YYYY-MM-DD".
 */
export function airingSchedule(state: EditorState, library: Library, today: string): Schedule | null {
  const clean = usable(state);
  return clean ? prepareSave(clean, library, today).schedule : null;
}

// ---------------------------------------------------------------- the week

function rowsOf(clean: EditorState, library: Library): AgendaRow[] {
  return clean.blocks.flatMap((block) =>
    block.items.flatMap((item) =>
      item.type === 'show'
        ? [
            {
              itemKey: item.key,
              blockKey: block.key,
              blockTime: block.time,
              blockStart: parseTime(block.time)!,
              show: item.show,
              showTitle: findShow(library, item.show)?.title ?? item.show,
              count: item.count,
            },
          ]
        : [],
    ),
  );
}

/** The rows of the week: every show item of the blocks, in the order of the day. */
export function agendaRows(state: EditorState, library: Library): AgendaRow[] {
  const clean = usable(state);
  return clean ? rowsOf(clean, library) : [];
}

/**
 * The week starting on the Monday `weekStart`: for each show item and airing day, the episodes the TV engine plays
 * (`planDay` on the grade the editor describes), whether a pick pins the cell, and whether it can be changed.
 * `today` is "YYYY-MM-DD": earlier days are shown but cannot be picked.
 */
export function buildWeek(state: EditorState, library: Library, weekStart: string, today: string): WeekGrid {
  const clean = usable(state);
  if (!clean) return { weekStart, dates: [], rows: [], cells: [] };
  const schedule = prepareSave(clean, library, today).schedule;
  const rows = rowsOf(clean, library);
  const dates = airingDates(weekStart, schedule.days);

  // Where each show item is in the grade: the index of its block and its position in the block.
  const where = new Map<number, { block: number; item: number }>();
  clean.blocks.forEach((block, blockIndex) => block.items.forEach((item, itemIndex) => where.set(item.key, { block: blockIndex, item: itemIndex })));

  const plans = new Map(dates.filter((date) => date >= schedule.startDate).map((date) => [date, planDay(schedule, library, date)]));
  const cells = rows.map((row) => {
    const at = where.get(row.itemKey)!;
    const show = findShow(library, row.show);
    const blocked = show ? blockedEpisodes(library, show) : new Set<number>();
    return dates.map((date): AgendaCell => {
      // A pick of another show (the item was changed) is dropped by the editor, so it pins nothing.
      const pick = state.picks.find((entry) => entry.itemKey === row.itemKey && entry.date === date && entry.show === row.show.trim().toLowerCase());
      const base = {
        date,
        itemKey: row.itemKey,
        pick: pick ? { episode: pick.episode, found: show !== undefined && !('error' in findEpisodeByRef(show, pick.episode)) } : null,
        drawn: show?.order === 'aleatoria' && !pick,
        editable: date >= today && date >= schedule.startDate,
      };
      const plan = plans.get(date);
      if (!plan) return { ...base, episodes: [], more: 0, empty: 'before-start' };
      const episodes = plan.blocks[at.block]!.items.flatMap((item) =>
        item.kind === 'episode' && item.itemIndex === at.item
          ? [{ index: item.episodeIndex, number: item.episode.number, season: item.episode.season, title: item.episode.title, blocked: blocked.has(item.episodeIndex) }]
          : [],
      );
      if (episodes.length === 0) return { ...base, episodes, more: 0, empty: (show?.episodes.length ?? 0) > 0 ? 'blocked' : 'missing' };
      return { ...base, episodes, more: Math.max(0, row.count - 1) };
    });
  });
  return { weekStart, dates, rows, cells };
}

// ---------------------------------------------------------------- picks

/** One episode in the list of a cell: what can be picked. */
export interface EpisodeChoice {
  index: number;
  /** The reference the agenda stores ("12", "temporada-02/12"); null when the episode cannot be told apart (no number in the file name). */
  ref: string | null;
  number: number | null;
  season: string | null;
  title: string;
  /** The "não passar" list holds it: picking it makes it air anyway. */
  blocked: boolean;
  /** The first episode the cell plays now. */
  current: boolean;
  /** The pick of the cell is this one. */
  picked: boolean;
}

/** The episodes of a row's show to choose from for a cell, in the order of the show. */
export function episodeChoices(library: Library, row: AgendaRow, cell: AgendaCell): EpisodeChoice[] {
  const show = findShow(library, row.show);
  if (!show) return [];
  const blocked = blockedEpisodes(library, show);
  const pinned = cell.pick && cell.pick.found ? findEpisodeByRef(show, cell.pick.episode) : null;
  return show.episodes.map((episode, index): EpisodeChoice => ({
    index,
    ref: episodeRef(show, index),
    number: episode.number,
    season: episode.season,
    title: episode.title,
    blocked: blocked.has(index),
    current: cell.episodes[0]?.index === index,
    picked: pinned !== null && 'index' in pinned && pinned.index === index,
  }));
}

/**
 * Where a pick for the item `itemKey` on `date` would stand in the saved grade (`AgendaPick`): the block and the position
 * of the item in it, as the file counts them. Null when the item is not a show of a usable block.
 */
export function agendaEntryOf(state: EditorState, itemKey: number, date: string, episode: string): AgendaPick | null {
  const clean = usable(state);
  for (const block of clean?.blocks ?? []) {
    const at = block.items.findIndex((item) => item.key === itemKey);
    if (at >= 0) return block.items[at]!.type === 'show' ? { date, blockStart: parseTime(block.time)!, item: at + 1, episode } : null;
  }
  return null;
}

/**
 * Pins the cell of the item `itemKey` on `date` to the episode `episode` (a reference, see `EpisodeChoice.ref`),
 * replacing the pick it had. From that cell on, the show goes on with the episodes that follow. A state without
 * that show item, or a date the grade does not air on, comes back unchanged.
 */
export function setPick(state: EditorState, itemKey: number, date: string, episode: string): EditorState {
  const located = locate(state, itemKey);
  if (!located || !state.days.includes(weekdayOf(isoToDayNumber(date)))) return state;
  const pick: EditorPick = { date, itemKey, show: located.show, episode, at: { blockStart: located.blockStart, item: located.item } };
  return { ...state, picks: [...state.picks.filter((entry) => !(entry.itemKey === itemKey && entry.date === date)), pick] };
}

/** Takes the pick off the cell: it is dynamic again. */
export function clearPick(state: EditorState, itemKey: number, date: string): EditorState {
  const picks = state.picks.filter((entry) => !(entry.itemKey === itemKey && entry.date === date));
  return picks.length === state.picks.length ? state : { ...state, picks };
}

function locate(state: EditorState, itemKey: number): { show: string; blockStart: number; item: number } | null {
  for (const block of state.blocks) {
    const index = block.items.findIndex((item) => item.key === itemKey);
    const item = block.items[index];
    if (!item) continue;
    if (item.type !== 'show') return null;
    return { show: item.show.trim().toLowerCase(), blockStart: parseTime(block.time) ?? 0, item: index + 1 };
  }
  return null;
}

// ---------------------------------------------------------------- words

/** "Ep. 12", "T2 · Ep. 12" (season folder "temporada-02") or "Sem número" for an episode. */
export function episodeLabel(episode: { number: number | null; season: string | null }): string {
  if (episode.number === null) return 'Sem número';
  if (!episode.season) return `Ep. ${episode.number}`;
  const season = /^temporada[-_ ]?0*(\d+)$/i.exec(episode.season);
  return `${season ? `T${season[1]}` : episode.season} · Ep. ${episode.number}`;
}

const DAY_SHORT: Record<Weekday, string> = { dom: 'dom', seg: 'seg', ter: 'ter', qua: 'qua', qui: 'qui', sex: 'sex', sab: 'sáb' };

/** "seg 12/10" for a date. */
export function dateLabel(date: string): string {
  const [, month, day] = date.split('-');
  return `${DAY_SHORT[weekdayOf(isoToDayNumber(date))]} ${day}/${month}`;
}

/** "12/10 a 18/10": the Monday to Sunday of a week. */
export function weekLabel(weekStart: string): string {
  const short = (date: string) => dateLabel(date).slice(4);
  return `${short(weekStart)} a ${short(dayNumberToIso(isoToDayNumber(weekStart) + 6))}`;
}
