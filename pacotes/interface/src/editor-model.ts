import {
  WEEKDAYS,
  formatTimeOfDay,
  isPlayableVideo,
  isoToDayNumber,
  naturalCompare,
  parseTimeOfDay,
  preservePositions,
  scheduleItemProblem,
  scheduleToYaml,
  weekdayOf,
  type AgendaPick,
  type Library,
  type Schedule,
  type ScheduleItem,
  type Weekday,
} from '@tv-gominho/nucleo';

// The model of the channel editor (Menu -> Programação -> Editar): a grade opened for editing, the operations
// on its blocks and items, what makes it invalid and how it becomes a Schedule to write back. No React or DOM
// in here, so it is all testable (see editor-model.test.ts); ChannelEditor.tsx only draws it.
//
// The editor edits only the name, description, days, blocks and items. Everything else of the grade (data_inicio,
// vinhetas_intervalo, intervalos, the agenda and the saved positions) stays as it was, with the agenda following
// the items it points at when they move.

/** An item of a block as it is being edited. `key` identifies it on screen; `from` is where it was in the file. */
export type EditorItem = (
  | { type: 'show'; show: string; count: number }
  | { type: 'interstitial'; ref: string }
  | { type: 'commercials'; count: number }
) & {
  key: number;
  /** Position (counting from 1) in the block of the opened grade, and for a show which show it was: what the agenda points at. */
  from?: { index: number; show?: string };
};

/** What `addItem` takes: an item without the bookkeeping. */
export type NewItem =
  | { type: 'show'; show: string; count: number }
  | { type: 'interstitial'; ref: string }
  | { type: 'commercials'; count: number };

export interface EditorBlock {
  key: number;
  /** The start as typed: "08:00" (or "08:00:30"). It may be invalid while it is being typed (see `timeProblem`). */
  time: string;
  /** Start (seconds) of the block in the opened grade, if it was there: what the agenda points at. */
  from?: number;
  items: EditorItem[];
}

export interface EditorState {
  /** Where the grade file is, from the folder picked (grades/x.yaml, under the library root). */
  path: string;
  name: string;
  description: string;
  days: Weekday[];
  blocks: EditorBlock[];
  nextKey: number;
  /** The grade as it was opened: what the editor does not edit is kept from it, and the old positions come from it. */
  base: Schedule;
  /** `signature` of the grade as opened, to tell whether anything changed. */
  opened: string;
}

export const MAX_NAME_LENGTH = 60;
export const MAX_DESCRIPTION_LENGTH = 300;
/** Most episodes or commercials in one item. */
export const MAX_COUNT = 99;
/** A block added after the last one starts this long after it. */
const NEW_BLOCK_GAP = 2 * 3600;

// ---------------------------------------------------------------- opening

/** Opens a grade for editing: blocks and items exactly as they are in the file. */
export function openEditor(schedule: Schedule): EditorState {
  let nextKey = 1;
  const blocks = schedule.blocks.map((block): EditorBlock => ({
    key: nextKey++,
    time: timeText(block.start),
    from: block.start,
    items: block.items.map((item, index): EditorItem => ({ ...item, key: nextKey++, from: { index: index + 1, ...(item.type === 'show' ? { show: item.show } : {}) } })),
  }));
  const state: EditorState = {
    path: schedule.path,
    name: schedule.name,
    description: schedule.description ?? '',
    days: [...schedule.days],
    blocks,
    nextKey,
    base: schedule,
    opened: '',
  };
  return { ...state, opened: signature(state) };
}

/** What can be edited, as text: two states with the same signature write the same grade. */
function signature(state: EditorState): string {
  return JSON.stringify([
    state.name,
    state.description,
    state.days,
    state.blocks.map((block) => [block.time, block.items.map(({ key: _key, from: _from, ...item }) => item)]),
  ]);
}

/** Whether anything was changed since the grade was opened. */
export function isDirty(state: EditorState): boolean {
  return signature(state) !== state.opened;
}

// ---------------------------------------------------------------- time

/** "08:00", or "08:00:30" when the time has seconds. */
export function timeText(seconds: number): string {
  return seconds % 60 === 0 ? formatTimeOfDay(seconds) : `${formatTimeOfDay(seconds)}:${String(seconds % 60).padStart(2, '0')}`;
}

/** The seconds of a typed time ("8:00", "08:00", "08:00:30"), or null when it is not a time of the day. */
export function parseTime(text: string): number | null {
  return parseTimeOfDay(text);
}

/** Why a typed time is not usable, in Portuguese, or null. */
export function timeProblem(text: string): string | null {
  if (text.trim() === '') return 'Escreva o horário do bloco, por exemplo 08:00.';
  return parseTime(text) === null ? `“${text.trim()}” não é um horário. Use HH:MM, por exemplo 08:00.` : null;
}

// ---------------------------------------------------------------- editing: the channel

export function setName(state: EditorState, name: string): EditorState {
  return { ...state, name };
}

export function setDescription(state: EditorState, description: string): EditorState {
  return { ...state, description };
}

/** Turns a day of the week on or off; the days stay in the order of the grade file (Sunday first). */
export function toggleDay(state: EditorState, day: Weekday): EditorState {
  const on = state.days.includes(day);
  return { ...state, days: WEEKDAYS.filter((entry) => (entry === day ? !on : state.days.includes(entry))) };
}

export function setDays(state: EditorState, days: Weekday[]): EditorState {
  return { ...state, days: WEEKDAYS.filter((day) => days.includes(day)) };
}

// ---------------------------------------------------------------- editing: blocks

/**
 * Adds a block with `items` after the last one (two hours after it, or at 08:00 with no blocks), at a time no
 * other block uses, and keeps the blocks sorted. Find the new one with `newestBlock`.
 */
export function addBlock(state: EditorState, items: NewItem[] = []): EditorState {
  const taken = new Set(state.blocks.map((block) => parseTime(block.time)).filter((time): time is number => time !== null));
  const last = Math.max(-1, ...taken);
  let start = last < 0 ? 8 * 3600 : last + NEW_BLOCK_GAP;
  // Past the end of the day: look for a free quarter of an hour from the start of the day.
  if (start >= 86_400) start = 0;
  while (taken.has(start)) start = (start + 900) % 86_400;
  let nextKey = state.nextKey;
  const block: EditorBlock = { key: nextKey++, time: timeText(start), items: items.map((item) => ({ ...item, key: nextKey++ })) };
  return settleBlocks({ ...state, blocks: [...state.blocks, block], nextKey });
}

/** The block `addBlock` added last (keys only grow). */
export function newestBlock(state: EditorState): EditorBlock | undefined {
  return state.blocks.reduce<EditorBlock | undefined>((best, block) => (best && best.key > block.key ? best : block), undefined);
}

export function removeBlock(state: EditorState, blockKey: number): EditorState {
  return { ...state, blocks: state.blocks.filter((block) => block.key !== blockKey) };
}

/** Sets what was typed as the start of a block. It is not sorted yet (see `settleBlocks`): the field may be half typed. */
export function setBlockTime(state: EditorState, blockKey: number, time: string): EditorState {
  return mapBlock(state, blockKey, (block) => ({ ...block, time }));
}

/**
 * Writes the valid times in their canonical form ("8:0" is not a time, "8:00" becomes "08:00") and sorts the blocks by
 * start. A block with a time that is not valid goes after the others, in the order it was. Same blocks, same keys.
 */
export function settleBlocks(state: EditorState): EditorState {
  const timed = state.blocks.map((block) => {
    const start = parseTime(block.time);
    return { block: start === null ? block : { ...block, time: timeText(start) }, start };
  });
  const sorted = [...timed].sort((a, b) => (a.start ?? Infinity) - (b.start ?? Infinity));
  return { ...state, blocks: sorted.map((entry) => entry.block) };
}

// ---------------------------------------------------------------- editing: items

export function addItem(state: EditorState, blockKey: number, item: NewItem): EditorState {
  const key = state.nextKey;
  return { ...mapBlock(state, blockKey, (block) => ({ ...block, items: [...block.items, { ...item, key }] })), nextKey: key + 1 };
}

export function removeItem(state: EditorState, blockKey: number, itemKey: number): EditorState {
  return mapBlock(state, blockKey, (block) => ({ ...block, items: block.items.filter((item) => item.key !== itemKey) }));
}

/** Moves an item up (-1) or down (1) in its block. At the ends nothing moves. */
export function moveItem(state: EditorState, blockKey: number, itemKey: number, direction: 1 | -1): EditorState {
  return mapBlock(state, blockKey, (block) => {
    const from = block.items.findIndex((item) => item.key === itemKey);
    const to = from + direction;
    if (from < 0 || to < 0 || to >= block.items.length) return block;
    const items = [...block.items];
    [items[from], items[to]] = [items[to]!, items[from]!];
    return { ...block, items };
  });
}

/** Changes the fields of an item (the quantity, the show, the vinheta). The kind of an item does not change: remove it and add another. */
export function updateItem(state: EditorState, blockKey: number, itemKey: number, patch: Partial<NewItem>): EditorState {
  return mapBlock(state, blockKey, (block) => ({
    ...block,
    items: block.items.map((item) => {
      if (item.key !== itemKey) return item;
      if (patch.type !== undefined && patch.type !== item.type) return item;
      const { type: _type, ...fields } = patch;
      return { ...item, ...fields } as EditorItem;
    }),
  }));
}

function mapBlock(state: EditorState, blockKey: number, change: (block: EditorBlock) => EditorBlock): EditorState {
  return { ...state, blocks: state.blocks.map((block) => (block.key === blockKey ? change(block) : block)) };
}

/** A new item of a kind with sensible starting values from the library. */
export function defaultItem(kind: ScheduleItem['type'], library: Library): NewItem {
  switch (kind) {
    case 'show': {
      const show = library.shows.find((entry) => entry.episodes.length > 0) ?? library.shows[0];
      return { type: 'show', show: show?.id ?? '', count: 1 };
    }
    case 'interstitial': {
      const categories = interstitialCategories(library);
      return { type: 'interstitial', ref: categories.includes('aberturas') ? 'aberturas' : (categories[0] ?? '') };
    }
    case 'commercials':
      return { type: 'commercials', count: 3 };
  }
}

// ---------------------------------------------------------------- choosing a vinheta

/** The categories of vinhetas/ in the library (aberturas, intervalos...), plus `extra` if it is not there. */
export function interstitialCategories(library: Library, extra?: string): string[] {
  const categories = new Set(library.interstitials.map((item) => item.category));
  if (extra) categories.add(extra.toLowerCase());
  return [...categories].sort(naturalCompare);
}

/** The category a vinheta reference starts in: "aberturas/2003" -> "aberturas". */
export function refCategory(ref: string): string {
  return (ref.split('/')[0] ?? '').toLowerCase();
}

export interface RefChoice {
  ref: string;
  /** 'category': draws from the whole category; 'folder': draws from a subfolder; 'file': that one file. */
  kind: 'category' | 'folder' | 'file';
  /** What the choice is, in Portuguese. */
  label: string;
  /** How many vinhetas it can draw from. */
  count: number;
}

/**
 * What a vinheta item of a category can point at: the whole category, each of its subfolders (the app draws one of
 * the files in it) or a specific file. In the order of the library folders, the category first.
 */
export function refChoices(library: Library, category: string): RefChoice[] {
  const key = category.toLowerCase();
  const inside = library.interstitials.filter((item) => item.category === key);
  const choices: RefChoice[] = [
    { ref: category, kind: 'category', label: `Sortear de toda a pasta ${category}`, count: inside.length },
  ];
  const folders = new Map<string, number>();
  const files: RefChoice[] = [];
  for (const item of inside) {
    const parts = item.relativePath.split('/');
    for (let depth = 2; depth < parts.length; depth++) {
      const folder = parts.slice(0, depth).join('/');
      folders.set(folder, (folders.get(folder) ?? 0) + 1);
    }
    files.push({ ref: item.relativePath, kind: 'file', label: `Arquivo ${parts.slice(1).join('/')}`, count: 1 });
  }
  const byPath = (a: { ref: string }, b: { ref: string }) => naturalCompare(a.ref, b.ref);
  const folderChoices = [...folders].map(([ref, count]): RefChoice => ({ ref, kind: 'folder', label: `Sortear da pasta ${ref.split('/').slice(1).join('/')}`, count }));
  return [...choices, ...folderChoices.sort(byPath), ...files.sort(byPath)];
}

/** Whether a vinheta reference names one file (as opposed to a folder to draw from). */
export function refIsFile(ref: string): boolean {
  return isPlayableVideo(ref.toLowerCase());
}

// ---------------------------------------------------------------- checking

export interface EditorCheck {
  /** What stops the grade from being saved, in Portuguese. Empty: it can be saved. */
  errors: string[];
  /** Per block key: a problem with its time or its content. */
  blocks: Record<number, string>;
  /** Per item key: a problem with its values (a quantity that is not a number...). */
  items: Record<number, string>;
  /** Per item key: it points at something the library does not have. The grade skips it, so saving is still allowed. */
  warnings: Record<number, string>;
}

function wholeCount(value: number): boolean {
  return Number.isInteger(value) && value >= 1 && value <= MAX_COUNT;
}

/**
 * Checks the edited grade. With the library it also warns about the items it does not have (`warnings`); those never
 * stop the grade from being saved, the engine just skips them.
 */
export function checkEditor(state: EditorState, library?: Library): EditorCheck {
  const check: EditorCheck = { errors: [], blocks: {}, items: {}, warnings: {} };
  const fail = (message: string) => {
    if (!check.errors.includes(message)) check.errors.push(message);
  };

  const name = state.name.trim();
  if (name === '') fail('Dê um nome ao canal.');
  else if (name.length > MAX_NAME_LENGTH) fail(`Use no máximo ${MAX_NAME_LENGTH} letras no nome.`);
  if (state.description.length > MAX_DESCRIPTION_LENGTH) fail(`Use no máximo ${MAX_DESCRIPTION_LENGTH} letras na descrição.`);
  if (state.days.length === 0) fail('Escolha pelo menos um dia da semana.');
  if (state.blocks.length === 0) fail('O canal precisa de pelo menos um bloco.');

  const starts = new Map<number, number>();
  for (const block of state.blocks) {
    const problem = timeProblem(block.time);
    if (problem) {
      check.blocks[block.key] = problem;
      fail(problem);
    } else {
      const start = parseTime(block.time)!;
      const other = starts.get(start);
      if (other !== undefined) {
        const message = `Dois blocos começam às ${formatTimeOfDay(start)}. Cada bloco precisa de um horário só dele.`;
        check.blocks[block.key] = message;
        check.blocks[other] ??= message;
        fail(message);
      }
      starts.set(start, block.key);
    }
    if (block.items.length === 0) {
      const label = problem ? 'Um bloco' : `O bloco das ${timeText(parseTime(block.time)!)}`;
      check.blocks[block.key] ??= `${label} está sem itens: acrescente um programa, uma vinheta ou comerciais.`;
      fail(`${label} está sem itens.`);
    }
    for (const item of block.items) checkItem(item, library, check, fail);
  }
  return check;
}

function checkItem(item: EditorItem, library: Library | undefined, check: EditorCheck, fail: (message: string) => void) {
  let problem: string | null = null;
  if (item.type === 'show') {
    if (item.show.trim() === '') problem = 'Escolha o programa.';
    else if (!wholeCount(item.count)) problem = `Use de 1 a ${MAX_COUNT} episódios.`;
  } else if (item.type === 'interstitial') {
    if (item.ref.trim() === '') problem = 'Escolha a vinheta.';
  } else if (!wholeCount(item.count)) {
    problem = `Use de 1 a ${MAX_COUNT} comerciais.`;
  }
  if (problem) {
    check.items[item.key] = problem;
    fail(problem);
    return;
  }
  // The same words the grade uses when the library is read (see scheduleItemProblem).
  const warning = library ? scheduleItemProblem(library, item) : null;
  if (warning) check.warnings[item.key] = warning;
}

// ---------------------------------------------------------------- building

/** The edited grade as a Schedule, and the agenda choices that could not come along. */
export interface EditorBuild {
  schedule: Schedule;
  /** Choices of the agenda that pointed at an item or block that was removed, a show that was changed, or a day that was turned off. */
  droppedPicks: AgendaPick[];
}

/**
 * The Schedule the editor describes: the edited name, description, days, blocks and items on top of the grade as it was
 * opened. The agenda follows the items it pointed at (by block and position in the file) and the saved positions of
 * shows that left the blocks or days that were turned off are dropped, since the grade would only warn about them.
 * Throws if the grade is not valid (see `checkEditor`).
 */
export function buildEditor(state: EditorState): EditorBuild {
  const problem = checkEditor(state).errors[0];
  if (problem) throw new Error(problem);

  const sorted = settleBlocks(state).blocks;
  const blocks = sorted.map((block) => ({
    start: parseTime(block.time)!,
    items: block.items.map(({ key: _key, from: _from, ...item }): ScheduleItem => item),
  }));
  const days = WEEKDAYS.filter((day) => state.days.includes(day));
  const description = state.description.trim();

  const { agenda: oldAgenda, positions: oldPositions, description: _description, ...rest } = state.base;
  const agenda: AgendaPick[] = [];
  const droppedPicks: AgendaPick[] = [];
  for (const pick of oldAgenda ?? []) {
    const moved = followPick(sorted, pick);
    if (moved && days.includes(weekdayOf(isoToDayNumber(pick.date)))) agenda.push(moved);
    else droppedPicks.push(pick);
  }
  agenda.sort((a, b) => a.date.localeCompare(b.date) || a.blockStart - b.blockStart || a.item - b.item);

  const inBlocks = new Set(blocks.flatMap((block) => block.items.flatMap((item) => (item.type === 'show' ? [item.show.toLowerCase()] : []))));
  const positions = (oldPositions ?? []).filter(
    (position) => inBlocks.has(position.show.toLowerCase()) && days.includes(weekdayOf(isoToDayNumber(position.date))),
  );

  const schedule: Schedule = {
    ...rest,
    name: state.name.trim(),
    ...(description !== '' ? { description } : {}),
    days,
    blocks,
    ...(agenda.length > 0 ? { agenda } : {}),
    ...(positions.length > 0 ? { positions } : {}),
  };
  return { schedule, droppedPicks };
}

/** Where an agenda choice of the opened grade is now: the same item of the same block, or null when it is gone or is another show. */
function followPick(blocks: EditorBlock[], pick: AgendaPick): AgendaPick | null {
  const block = blocks.find((entry) => entry.from === pick.blockStart);
  if (!block) return null;
  const at = block.items.findIndex((item) => item.from?.index === pick.item);
  const item = block.items[at];
  if (!item || item.type !== 'show' || item.from?.show?.toLowerCase() !== item.show.trim().toLowerCase()) return null;
  return { ...pick, blockStart: parseTime(block.time)!, item: at + 1 };
}

/** Whether the edit changes what airs (the days or the items), as opposed to only the name, the description or the times. */
export function changesAiring(state: EditorState, edited: Schedule): boolean {
  const shape = (schedule: Schedule) => JSON.stringify([schedule.days, schedule.blocks.map((block) => block.items)]);
  return shape(state.base) !== shape(edited);
}

/**
 * What to write: the built grade, with the saved positions of every show (see `preservePositions`) when the edit
 * changes what airs, so no show jumps. `date` is today ("YYYY-MM-DD"). An edit that only renames the channel or
 * moves a block leaves the positions as they were.
 */
export function prepareSave(state: EditorState, library: Library, date: string): EditorBuild {
  const built = buildEditor(state);
  if (!changesAiring(state, built.schedule)) return built;
  return { ...built, schedule: preservePositions(state.base, built.schedule, library, date) };
}

/** The text of the grade file for an edited schedule. Comments of the old file are not kept (see docs/grade.md). */
export function editedYaml(schedule: Schedule, date: string): string {
  return scheduleToYaml({ schedule }, [`Editada pelo app em ${date}. Pode editar à vontade (veja docs/grade.md).`]);
}
