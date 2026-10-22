import { planDay, scanLibrary, type Library, type LibrarySource, type Schedule } from '@tv-gominho/nucleo';
import { describe, expect, it } from 'vitest';
import {
  agendaEntryOf,
  airingOf,
  agendaRows,
  airingDates,
  buildWeek,
  clearPick,
  dateLabel,
  episodeChoices,
  episodeLabel,
  setPick,
  shiftWeek,
  weekLabel,
  weekStartOf,
  type AgendaCell,
  type WeekGrid,
} from './agenda-model';
import { addItem, buildEditor, editedYaml, isDirty, moveItem, openEditor, prepareSave, setBlockTime, toggleDay, updateItem, type EditorState } from './editor-model';

function memorySource(files: Record<string, string>): LibrarySource {
  return {
    files: Object.keys(files),
    async readText(path) {
      const text = files[path];
      if (text === undefined) throw new Error(`No such file: ${path}`);
      return text;
    },
  };
}

// 2003-03-03 is a Monday. dbz airs once a day at 08:00, bob twice (episodios: 2), dbz again at 10:30.
const GRADE = `nome: Manhãs
data_inicio: 2003-03-03
dias: [seg, ter, qua, qui, sex]
blocos:
  - horario: "08:00"
    itens:
      - vinheta: aberturas
      - programa: dbz
      - programa: bob
        episodios: 2
  - horario: "10:30"
    itens:
      - programa: sorte
`;

const episodes = (show: string, count: number, from = 1) => Object.fromEntries(Array.from({ length: count }, (_, i) => [`programas/${show}/episodios/${String(from + i).padStart(3, '0')}.mp4`, '']));

const FILES: Record<string, string> = {
  'programas/dbz/programa.yaml': 'titulo: DBZ',
  ...episodes('dbz', 8),
  'programas/bob/programa.yaml': 'titulo: Bob Esponja',
  ...episodes('bob', 12),
  'programas/sorte/programa.yaml': 'titulo: Sorte\nordem: aleatoria',
  ...episodes('sorte', 9),
  'vinhetas/aberturas/a1.mp4': '',
  'grades/manhas.yaml': GRADE,
};

const WEEK = '2003-03-03';
/** The first day of the grade, so every day of the week can be picked. */
const TODAY = '2003-03-03';

async function setup(extra: Record<string, string> = {}, grade = GRADE) {
  const library: Library = await scanLibrary(memorySource({ ...FILES, ...extra, 'grades/manhas.yaml': grade }));
  const schedule = library.schedules.find((entry) => entry.id === 'manhas')!;
  return { library, schedule, state: openEditor(schedule) };
}

const keyOf = (state: EditorState, time: string, index: number) => state.blocks.find((block) => block.time === time)!.items[index]!.key;
const rowOf = (grid: WeekGrid, show: string, time = '08:00') => grid.rows.findIndex((row) => row.show === show && row.blockTime === time);
const numbers = (cell: AgendaCell) => cell.episodes.map((episode) => episode.number);
const column = (grid: WeekGrid, row: number) => grid.cells[row]!.map(numbers);

describe('weeks', () => {
  it('finds the Monday of a week and moves between weeks', () => {
    expect(weekStartOf('2003-03-05')).toBe('2003-03-03');
    expect(weekStartOf('2003-03-09')).toBe('2003-03-03');
    expect(weekStartOf('2003-03-10')).toBe('2003-03-10');
    expect(shiftWeek('2003-03-03', 1)).toBe('2003-03-10');
    expect(shiftWeek('2003-03-03', -1)).toBe('2003-02-24');
    expect(weekLabel('2003-03-03')).toBe('03/03 a 09/03');
    expect(dateLabel('2003-03-05')).toBe('qua 05/03');
  });

  it('words episodes the short way', () => {
    expect(episodeLabel({ number: 12, season: null })).toBe('Ep. 12');
    expect(episodeLabel({ number: 3, season: 'temporada-02' })).toBe('T2 · Ep. 3');
    expect(episodeLabel({ number: 3, season: 'Especiais' })).toBe('Especiais · Ep. 3');
    expect(episodeLabel({ number: null, season: null })).toBe('Sem número');
  });

  it('shows only the days the grade airs on', () => {
    expect(airingDates('2003-03-03', ['seg', 'qua', 'sab'])).toEqual(['2003-03-03', '2003-03-05', '2003-03-08']);
  });
});

describe('the grade as it airs', () => {
  it('ties each item of the grade to the item of the editor, even after blocks and items move', async () => {
    const { library, state } = await setup();
    const airing = airingOf(state, library, TODAY)!;
    expect(airing.itemKeyAt(0, 1)).toBe(keyOf(state, '08:00', 1));
    expect(airing.itemKeyAt(1, 0)).toBe(keyOf(state, '10:30', 0));
    expect(airing.itemKeyAt(5, 0)).toBeUndefined();

    // The 10:30 block goes first: block 0 of the grade is now that one.
    const moved = setBlockTime(state, state.blocks[1]!.key, '07:00');
    const early = airingOf(moved, library, TODAY)!;
    expect(early.schedule.blocks.map((block) => block.start)).toEqual([7 * 3600, 8 * 3600]);
    expect(early.itemKeyAt(0, 0)).toBe(keyOf(moved, '07:00', 0));
    expect(early.itemKeyAt(1, 2)).toBe(keyOf(moved, '08:00', 2));
  });

  it('leaves out what is not usable yet, and has nothing when nothing is', async () => {
    const { library, state } = await setup();
    const typing = airingOf(setBlockTime(state, state.blocks[1]!.key, '10:'), library, TODAY)!;
    expect(typing.schedule.blocks).toHaveLength(1);
    expect(airingOf(toggleDay(toggleDay(toggleDay(toggleDay(toggleDay(state, 'seg'), 'ter'), 'qua'), 'qui'), 'sex'), library, TODAY)).toBeNull();
  });
});

describe('the week of a grade', () => {
  it('has a row per show item and a column per airing day', async () => {
    const { library, state } = await setup();
    const grid = buildWeek(state, library, WEEK, TODAY);
    expect(grid.dates).toEqual(['2003-03-03', '2003-03-04', '2003-03-05', '2003-03-06', '2003-03-07']);
    expect(grid.rows.map((row) => [row.blockTime, row.show, row.showTitle, row.count])).toEqual([
      ['08:00', 'dbz', 'DBZ', 1],
      ['08:00', 'bob', 'Bob Esponja', 2],
      ['10:30', 'sorte', 'Sorte', 1],
    ]);
    expect(grid.cells).toHaveLength(3);
    expect(grid.cells.every((cells) => cells.length === 5)).toBe(true);
    expect(agendaRows(state, library)).toEqual(grid.rows);
  });

  it('predicts what the TV engine plays', async () => {
    const { library, state } = await setup();
    const grid = buildWeek(state, library, WEEK, TODAY);
    const { schedule } = prepareSave(state, library, TODAY);
    grid.dates.forEach((date, day) => {
      const plan = planDay(schedule, library, date);
      const planned = plan.blocks.flatMap((block, blockIndex) =>
        block.items.flatMap((item) => (item.kind === 'episode' ? [[blockIndex, item.show.id, item.episodeIndex] as const] : [])),
      );
      const shown = grid.rows.flatMap((row, r) => grid.cells[r]![day]!.episodes.map((episode) => [row.blockTime === '08:00' ? 0 : 1, row.show, episode.index] as const));
      expect(shown).toEqual(planned);
    });
    // dbz: one episode per day, from the premiere.
    expect(column(grid, rowOf(grid, 'dbz'))).toEqual([[1], [2], [3], [4], [5]]);
    // bob plays two a day and shows the first one and "+1".
    expect(column(grid, rowOf(grid, 'bob'))).toEqual([[1, 2], [3, 4], [5, 6], [7, 8], [9, 10]]);
    expect(grid.cells[rowOf(grid, 'bob')]![0]!.more).toBe(1);
    expect(grid.cells[rowOf(grid, 'dbz')]![0]!.more).toBe(0);
    expect(grid.cells[0]![0]!.episodes[0]!.title).toBeTruthy();
  });

  it('continues across weeks', async () => {
    const { library, state } = await setup();
    const next = buildWeek(state, library, shiftWeek(WEEK, 1), TODAY);
    expect(column(next, rowOf(next, 'dbz'))).toEqual([[6], [7], [8], [1], [2]]);
  });

  it('predicts the unsaved state: moved blocks, days and other shows', async () => {
    const { library, state } = await setup();
    // dbz gets the 10:30 block's company and the grade stops airing on Wednesday.
    let next = toggleDay(state, 'qua');
    next = updateItem(next, next.blocks[1]!.key, keyOf(next, '10:30', 0), { show: 'dbz' });
    const grid = buildWeek(next, library, WEEK, TODAY);
    expect(grid.dates).not.toContain('2003-03-05');
    const { schedule } = prepareSave(next, library, TODAY);
    grid.dates.forEach((date, day) => {
      const plan = planDay(schedule, library, date);
      const first = plan.blocks[0]!.items.find((item) => item.kind === 'episode' && item.show.id === 'dbz');
      expect(grid.cells[rowOf(grid, 'dbz')]![day]!.episodes[0]!.index).toBe(first && first.kind === 'episode' ? first.episodeIndex : -1);
    });
    expect(grid.rows.map((row) => [row.blockTime, row.show])).toEqual([
      ['08:00', 'dbz'],
      ['08:00', 'bob'],
      ['10:30', 'dbz'],
    ]);
  });

  it('still shows the week while another part of the editor is invalid', async () => {
    const { library, state } = await setup();
    const typing = setBlockTime(state, state.blocks[1]!.key, '10:');
    const grid = buildWeek(typing, library, WEEK, TODAY);
    expect(grid.rows.map((row) => row.show)).toEqual(['dbz', 'bob']);
    expect(buildWeek(toggleDay(toggleDay(toggleDay(toggleDay(toggleDay(state, 'seg'), 'ter'), 'qua'), 'qui'), 'sex'), library, WEEK, TODAY).rows).toEqual([]);
  });

  it('marks the days before today and before the premiere as not editable', async () => {
    const { library, state } = await setup();
    const grid = buildWeek(state, library, WEEK, '2003-03-05');
    expect(grid.cells[0]!.map((cell) => cell.editable)).toEqual([false, false, true, true, true]);
    const before = buildWeek(state, library, '2003-02-24', TODAY);
    expect(before.cells[0]!.every((cell) => cell.empty === 'before-start' && !cell.editable && cell.episodes.length === 0)).toBe(true);
  });
});

describe('picking an episode', () => {
  it('pins the cell and the days after it continue from the pick', async () => {
    const { library, state } = await setup();
    const before = buildWeek(state, library, WEEK, TODAY);
    const dbz = keyOf(state, '08:00', 1);
    const picked = setPick(state, dbz, '2003-03-04', '7');
    const grid = buildWeek(picked, library, WEEK, TODAY);
    const row = rowOf(grid, 'dbz');
    // Monday is as before, Tuesday is the pick, and the rest goes on from 7 (and wraps after 8).
    expect(column(grid, row)).toEqual([[1], [7], [8], [1], [2]]);
    expect(grid.cells[row]!.map((cell) => cell.pick?.episode ?? null)).toEqual([null, '7', null, null, null]);
    expect(grid.cells[row]![1]!.pick).toEqual({ episode: '7', found: true });
    // Other rows do not move.
    expect(column(grid, rowOf(grid, 'bob'))).toEqual(column(before, rowOf(before, 'bob')));
    expect(isDirty(picked)).toBe(true);
  });

  it('replaces an earlier pick of the same cell and keeps the others', async () => {
    const { library, state } = await setup();
    const dbz = keyOf(state, '08:00', 1);
    let next = setPick(state, dbz, '2003-03-04', '7');
    next = setPick(next, dbz, '2003-03-06', '3');
    next = setPick(next, dbz, '2003-03-04', '5');
    expect(next.picks.map((pick) => [pick.date, pick.episode])).toEqual([
      ['2003-03-06', '3'],
      ['2003-03-04', '5'],
    ]);
    const row = buildWeek(next, library, WEEK, TODAY).cells[0]!;
    expect(row.map(numbers)).toEqual([[1], [5], [6], [3], [4]]);
  });

  it('goes to the file in the position the item has there, and the saved grade plays what the cell showed', async () => {
    const { library, state } = await setup();
    const bob = keyOf(state, '08:00', 2);
    const picked = setPick(state, bob, '2003-03-05', '9');
    const week = buildWeek(picked, library, WEEK, TODAY);

    expect(agendaEntryOf(picked, bob, '2003-03-05', '9')).toEqual({ date: '2003-03-05', blockStart: 8 * 3600, item: 3, episode: '9' });
    const built = buildEditor(picked);
    expect(built.droppedPicks).toEqual([]);
    expect(built.schedule.agenda).toEqual([{ date: '2003-03-05', blockStart: 8 * 3600, item: 3, episode: '9' }]);

    // Save, read the file back, and the TV plays exactly what the week predicted.
    const reread = await setup({}, editedYaml(built.schedule, TODAY));
    const reopened = buildWeek(reread.state, reread.library, WEEK, TODAY);
    expect(reopened.cells).toEqual(week.cells.map((cells) => cells.map((cell) => ({ ...cell, itemKey: expect.any(Number) }))));
    expect(column(reopened, rowOf(reopened, 'bob'))).toEqual([[1, 2], [3, 4], [9, 10], [11, 12], [1, 2]]);
    reopened.dates.forEach((date, day) => {
      const plan = planDay(reread.schedule, reread.library, date);
      const bobs = plan.blocks[0]!.items.flatMap((item) => (item.kind === 'episode' && item.show.id === 'bob' ? [item.episodeIndex + 1] : []));
      expect(bobs).toEqual(column(reopened, rowOf(reopened, 'bob'))[day]);
    });
  });

  it('pins every episode of an item with episodios: N, and shows the first with "+N-1"', async () => {
    const { library, state } = await setup();
    const picked = setPick(state, keyOf(state, '08:00', 2), '2003-03-04', '6');
    const cell = buildWeek(picked, library, WEEK, TODAY).cells[rowOf(buildWeek(picked, library, WEEK, TODAY), 'bob')]![1]!;
    expect(numbers(cell)).toEqual([6, 7]);
    expect(cell.more).toBe(1);
    expect(cell.pick).toEqual({ episode: '6', found: true });
  });

  it('works for a show that draws its episodes: the cell shows the draw, the pick overrides it', async () => {
    const { library, state } = await setup();
    const before = buildWeek(state, library, WEEK, TODAY);
    const row = rowOf(before, 'sorte', '10:30');
    expect(before.cells[row]!.every((cell) => cell.drawn && cell.episodes.length === 1)).toBe(true);

    const picked = setPick(state, keyOf(state, '10:30', 0), '2003-03-05', '4');
    const grid = buildWeek(picked, library, WEEK, TODAY);
    const cell = grid.cells[row]![2]!;
    expect(numbers(cell)).toEqual([4]);
    expect(cell.drawn).toBe(false);
    expect(cell.pick).toEqual({ episode: '4', found: true });
    // The days after it are still drawn, and are the same draws as before.
    expect(grid.cells[row]!.map((c) => c.drawn)).toEqual([true, true, false, true, true]);
    expect(grid.cells[row]!.map((c, i) => (i === 2 ? null : numbers(c)))).toEqual(before.cells[row]!.map((c, i) => (i === 2 ? null : numbers(c))));
  });

  it('predicts with the nao-passar list, but lets a blocked episode be picked', async () => {
    const { library, state } = await setup({ 'nao-passar.yaml': 'episodios:\n  dbz: [2, 4]\n' });
    const grid = buildWeek(state, library, WEEK, TODAY);
    // 2 and 4 are skipped: the count runs over the allowed ones.
    expect(column(grid, rowOf(grid, 'dbz'))).toEqual([[1], [3], [5], [6], [7]]);
    expect(grid.cells[0]!.every((cell) => cell.episodes.every((episode) => !episode.blocked))).toBe(true);

    const choices = episodeChoices(library, grid.rows[0]!, grid.cells[0]![1]!);
    expect(choices.map((choice) => [choice.number, choice.blocked])).toEqual([[1, false], [2, true], [3, false], [4, true], [5, false], [6, false], [7, false], [8, false]]);
    expect(choices.filter((choice) => choice.current).map((choice) => choice.number)).toEqual([3]);

    const picked = setPick(state, keyOf(state, '08:00', 1), '2003-03-04', '2');
    const after = buildWeek(picked, library, WEEK, TODAY);
    const cell = after.cells[0]![1]!;
    expect(cell.episodes.map((episode) => [episode.number, episode.blocked])).toEqual([[2, true]]);
    // ...and the show goes on with the allowed episodes after it.
    expect(column(after, 0)).toEqual([[1], [2], [3], [5], [6]]);
  });

  it('marks the picked episode in the list and the one playing now', async () => {
    const { library, state } = await setup();
    const picked = setPick(state, keyOf(state, '08:00', 1), '2003-03-04', '7');
    const grid = buildWeek(picked, library, WEEK, TODAY);
    const choices = episodeChoices(library, grid.rows[0]!, grid.cells[0]![1]!);
    expect(choices.filter((choice) => choice.picked).map((choice) => choice.number)).toEqual([7]);
    expect(choices.filter((choice) => choice.current).map((choice) => choice.number)).toEqual([7]);
    expect(choices.every((choice) => choice.ref === String(choice.number))).toBe(true);
  });

  it('uses the season in the reference when a number repeats', async () => {
    const seasons: Record<string, string> = {
      'programas/dbz/episodios/temporada-01/001.mp4': '',
      'programas/dbz/episodios/temporada-01/002.mp4': '',
      'programas/dbz/episodios/temporada-02/001.mp4': '',
    };
    const files = Object.fromEntries(Object.entries(FILES).filter(([path]) => !path.startsWith('programas/dbz/episodios')));
    const library = await scanLibrary(memorySource({ ...files, ...seasons, 'grades/manhas.yaml': GRADE }));
    const state = openEditor(library.schedules[0]!);
    const grid = buildWeek(state, library, WEEK, TODAY);
    const choices = episodeChoices(library, grid.rows[0]!, grid.cells[0]![0]!);
    expect(choices.map((choice) => choice.ref)).toEqual(['temporada-01/1', '2', 'temporada-02/1']);
    const picked = setPick(state, grid.rows[0]!.itemKey, '2003-03-04', 'temporada-02/1');
    const after = buildWeek(picked, library, WEEK, TODAY);
    expect(after.cells[0]![1]!.episodes.map((episode) => [episode.season, episode.number])).toEqual([['temporada-02', 1]]);
  });
});

describe('going back to dynamic', () => {
  it('removes the pick: the cells are what they were and the editor is not dirty', async () => {
    const { library, state } = await setup();
    const before = buildWeek(state, library, WEEK, TODAY);
    const dbz = keyOf(state, '08:00', 1);
    const picked = setPick(state, dbz, '2003-03-04', '7');
    const reset = clearPick(picked, dbz, '2003-03-04');
    expect(buildWeek(reset, library, WEEK, TODAY)).toEqual(before);
    expect(isDirty(reset)).toBe(false);
    expect(buildEditor(reset).schedule.agenda).toBeUndefined();
    // Resetting a cell that has no pick changes nothing.
    expect(clearPick(state, dbz, '2003-03-05')).toBe(state);
  });

  it('removes a pick that was already in the file', async () => {
    const withPick = `${GRADE}
agenda:
  "2003-03-05":
    - bloco: "08:00"
      item: 2
      episodio: 6
`;
    const { library, state } = await setup({}, withPick);
    const dbz = keyOf(state, '08:00', 1);
    const grid = buildWeek(state, library, WEEK, TODAY);
    expect(grid.cells[0]!.map((cell) => cell.pick?.episode ?? null)).toEqual([null, null, '6', null, null]);
    expect(column(grid, 0)).toEqual([[1], [2], [6], [7], [8]]);

    const reset = clearPick(state, dbz, '2003-03-05');
    expect(isDirty(reset)).toBe(true);
    expect(buildEditor(reset).schedule.agenda).toBeUndefined();
    expect(column(buildWeek(reset, library, WEEK, TODAY), 0)).toEqual([[1], [2], [3], [4], [5]]);
  });
});

describe('picks and the other edits', () => {
  it('follows the item when blocks move and items are reordered', async () => {
    const { library, state } = await setup();
    const bob = keyOf(state, '08:00', 2);
    const picked = setPick(state, bob, '2003-03-05', '9');
    // bob goes above dbz in its block; the 10:30 block goes to 07:00.
    let next = moveItem(picked, picked.blocks[0]!.key, bob, -1);
    next = setBlockTime(next, picked.blocks[0]!.key, '09:00');
    const built = buildEditor(next);
    expect(built.droppedPicks).toEqual([]);
    expect(built.schedule.agenda).toEqual([{ date: '2003-03-05', blockStart: 9 * 3600, item: 2, episode: '9' }]);
    expect(agendaEntryOf(next, bob, '2003-03-05', '9')).toEqual(built.schedule.agenda![0]);
    const grid = buildWeek(next, library, WEEK, TODAY);
    expect(grid.cells[rowOf(grid, 'bob', '09:00')]![2]!.pick?.episode).toBe('9');
  });

  it('drops the pick when the item becomes another show or the day is turned off, and says so', async () => {
    const { library, state } = await setup();
    const bob = keyOf(state, '08:00', 2);
    const picked = setPick(state, bob, '2003-03-05', '9');

    const other = updateItem(picked, picked.blocks[0]!.key, bob, { show: 'dbz' });
    expect(buildEditor(other).droppedPicks).toHaveLength(1);
    expect(buildEditor(other).schedule.agenda).toBeUndefined();
    const grid = buildWeek(other, library, WEEK, TODAY);
    expect(grid.cells.flat().every((cell) => cell.pick === null)).toBe(true);

    // The same show in other letters keeps it.
    expect(buildEditor(updateItem(picked, picked.blocks[0]!.key, bob, { show: 'BOB' })).droppedPicks).toEqual([]);

    const noDay = buildEditor(toggleDay(picked, 'qua'));
    expect(noDay.droppedPicks).toHaveLength(1);
  });

  it('can pin an item added in this session', async () => {
    const { library, state } = await setup();
    const added = addItem(state, state.blocks[1]!.key, { type: 'show', show: 'bob', count: 1 });
    const key = added.nextKey - 1;
    const picked = setPick(added, key, '2003-03-04', '5');
    const grid = buildWeek(picked, library, WEEK, TODAY);
    const row = rowOf(grid, 'bob', '10:30');
    expect(numbers(grid.cells[row]![1]!)).toEqual([5]);
    expect(buildEditor(picked).schedule.agenda).toEqual([{ date: '2003-03-04', blockStart: 10.5 * 3600, item: 2, episode: '5' }]);
  });

  it('ignores a pick for a day the grade does not air on, for a missing item, and for a vinheta', async () => {
    const { state } = await setup();
    const dbz = keyOf(state, '08:00', 1);
    // 2003-03-08 is a Saturday.
    expect(setPick(state, dbz, '2003-03-08', '3')).toBe(state);
    expect(setPick(state, 9999, '2003-03-04', '3')).toBe(state);
    expect(setPick(state, keyOf(state, '08:00', 0), '2003-03-04', '3')).toBe(state);
    expect(agendaEntryOf(state, keyOf(state, '08:00', 0), '2003-03-04', '3')).toBeNull();
  });
});

describe('a grade the library does not fully have', () => {
  it('shows an empty cell for a missing show and for a show with everything blocked', async () => {
    const { library, state } = await setup({ 'nao-passar.yaml': 'programas: [bob]\n' });
    const missing = updateItem(state, state.blocks[1]!.key, keyOf(state, '10:30', 0), { show: 'sumiu' });
    const grid = buildWeek(missing, library, WEEK, TODAY);
    expect(grid.cells[rowOf(grid, 'sumiu', '10:30')]!.every((cell) => cell.empty === 'missing' && cell.episodes.length === 0)).toBe(true);
    expect(grid.cells[rowOf(grid, 'bob')]!.every((cell) => cell.empty === 'blocked')).toBe(true);
    // A blocked show can still be pinned: the pick airs.
    const picked = setPick(missing, keyOf(missing, '08:00', 2), '2003-03-04', '3');
    const cell = buildWeek(picked, library, WEEK, TODAY).cells[rowOf(grid, 'bob')]![1]!;
    expect(cell.episodes.map((episode) => [episode.number, episode.blocked])).toEqual([[3, true]]);
  });

  it('keeps a pick whose episode is gone as pinned but not found', async () => {
    const { library, state } = await setup();
    const picked = setPick(state, keyOf(state, '08:00', 1), '2003-03-04', '99');
    const cell = buildWeek(picked, library, WEEK, TODAY).cells[0]![1]!;
    expect(cell.pick).toEqual({ episode: '99', found: false });
    expect(numbers(cell)).toEqual([2]);
  });
});

describe('the opened schedule', () => {
  it('is untouched by the model', async () => {
    const { schedule, state } = await setup();
    const copy: Schedule = JSON.parse(JSON.stringify(schedule));
    setPick(state, keyOf(state, '08:00', 1), '2003-03-04', '7');
    expect(schedule).toEqual(copy);
  });
});
