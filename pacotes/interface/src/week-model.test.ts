import { DEFAULT_SETTINGS, formatTimeOfDay, previewDay, scanLibrary, type Library, type LibrarySource } from '@tv-gominho/nucleo';
import { describe, expect, it } from 'vitest';
import { airingOf, setPick } from './agenda-model';
import { openEditor, setBlockTime } from './editor-model';
import { airingLabel, buildWeekModel } from './week-model';

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

// 2003-03-03 is a Monday. dbz plays one episode at 08:00 and bob two, and dbz again at 10:30 on a grade for the week.
const GRADE = `nome: Manhãs
data_inicio: 2003-03-03
dias: [seg, ter, qua, qui, sex]
blocos:
  - horario: "08:00"
    itens:
      - programa: dbz
      - programa: bob
        episodios: 2
  - horario: "10:30"
    itens:
      - programa: dbz
`;

const episodes = (show: string, count: number) => Object.fromEntries(Array.from({ length: count }, (_, i) => [`programas/${show}/episodios/${String(i + 1).padStart(3, '0')} - Titulo ${i + 1}.mp4`, '']));

const FILES: Record<string, string> = {
  'programas/dbz/programa.yaml': 'titulo: DBZ',
  ...episodes('dbz', 12),
  'programas/bob/programa.yaml': 'titulo: Bob Esponja',
  ...episodes('bob', 12),
  'grades/manhas.yaml': GRADE,
};

const WEEK = ['2003-03-03', '2003-03-04', '2003-03-05', '2003-03-06', '2003-03-07', '2003-03-08', '2003-03-09'];
const TODAY = '2003-03-03';
const NO_ADS = { ...DEFAULT_SETTINGS, commercials: false, interstitials: false };
const EPISODE = 22 * 60;
const durationOf = (path: string) => (path.includes('/dbz/') ? EPISODE : 11 * 60);

async function setup(extra: Record<string, string> = {}) {
  const library: Library = await scanLibrary(memorySource({ ...FILES, ...extra }));
  const schedule = library.schedules[0]!;
  return { library, schedule, state: openEditor(schedule) };
}

describe('the week of a channel', () => {
  it('shows the same times and episodes as the day preview', async () => {
    const { library, schedule } = await setup();
    const options = { settings: NO_ADS, durationOf };
    const week = buildWeekModel(schedule, library, WEEK, options);

    expect(week.days.map((day) => day.date)).toEqual(WEEK);
    for (const day of week.days) {
      const preview = previewDay(schedule, library, day.date, options);
      expect(day.airings.map((airing) => [airing.start, airing.time, airing.episodeIndex, airing.showId])).toEqual(
        preview.rows.map((row) => [row.start, formatTimeOfDay(row.start), row.episodeIndex, row.show.id]),
      );
    }
    // Real times, not the time of the block over and over: dbz at 08:00, then the two bobs one after the other.
    expect(week.days[0]!.airings.map((airing) => [airing.time, airing.showTitle, airing.label])).toEqual([
      ['08:00', 'DBZ', 'Ep. 1'],
      ['08:22', 'Bob Esponja', 'Ep. 1'],
      ['08:33', 'Bob Esponja', 'Ep. 2'],
      ['10:30', 'DBZ', 'Ep. 2'],
    ]);
    expect(week.days[0]!.airings[1]!.title).toBe('Titulo 1');
  });

  it('marks the days the channel does not air on, and keeps them in the week', async () => {
    const { library, schedule } = await setup();
    const week = buildWeekModel(schedule, library, WEEK, { settings: NO_ADS, durationOf });
    expect(week.days.map((day) => day.airs)).toEqual([true, true, true, true, true, false, false]);
    expect(week.days[5]!.airings).toEqual([]);
    expect(week.days[5]!.label).toBe('Sáb 08/03');
  });

  it('says the times are guesses until the durations are known', async () => {
    const { library, schedule } = await setup();
    const guessed = buildWeekModel(schedule, library, WEEK, { settings: NO_ADS, durationOf: () => undefined });
    expect(guessed.estimated).toBe(true);
    expect(guessed.paths.length).toBeGreaterThan(0);
    expect(buildWeekModel(schedule, library, WEEK, { settings: NO_ADS, durationOf }).estimated).toBe(false);
  });

  it('puts the days before the premiere in the week with nothing on them', async () => {
    const { library, schedule } = await setup();
    const week = buildWeekModel(schedule, library, ['2003-02-28', '2003-03-03'], { settings: NO_ADS, durationOf });
    expect(week.days[0]).toMatchObject({ beforeStart: true, airs: true, airings: [] });
    expect(week.days[1]!.beforeStart).toBe(false);
  });

  it('merges a warning that repeats on several days into one with its days', async () => {
    // The 08:00 block (dbz + two bobs: 55 min) runs over a block at 08:30.
    const { library, state } = await setup();
    const tight = setBlockTime(state, state.blocks[1]!.key, '08:30');
    const built = airingOf(tight, library, TODAY)!;
    const week = buildWeekModel(built.schedule, library, WEEK, { settings: NO_ADS, durationOf });
    expect(week.warnings).toHaveLength(1);
    expect(week.warnings[0]!.kind).toBe('overlap');
    expect(week.warnings[0]!.days).toEqual(['Seg 03/03', 'Ter 04/03', 'Qua 05/03', 'Qui 06/03', 'Sex 07/03']);
  });
});

describe('picks in the week', () => {
  it('marks the picked episode and the others stay dynamic, with the times following it', async () => {
    const { library, state } = await setup();
    const dbz = state.blocks[0]!.items[0]!.key;
    const picked = setPick(state, dbz, '2003-03-04', '7');
    const { schedule, itemKeyAt } = airingOf(picked, library, TODAY)!;
    const week = buildWeekModel(schedule, library, WEEK, { settings: NO_ADS, durationOf, today: TODAY, itemKeyAt });

    const tuesday = week.days[1]!.airings;
    expect(tuesday[0]).toMatchObject({ time: '08:00', showId: 'dbz', label: 'Ep. 7', pinned: true, itemKey: dbz });
    // Only that cell is pinned: the other airings of the day and of the week are not.
    expect(week.days.flatMap((day) => day.airings).filter((airing) => airing.pinned)).toHaveLength(1);
    // The days after the pick go on from it; the 10:30 dbz is the next one.
    expect(tuesday.filter((airing) => airing.showId === 'dbz').map((airing) => airing.label)).toEqual(['Ep. 7', 'Ep. 8']);
    expect(week.days[2]!.airings[0]!.label).toBe('Ep. 9');
  });

  it('pins only the first episode of an item with several, and ties every one to the item', async () => {
    const { library, state } = await setup();
    const bob = state.blocks[0]!.items[1]!.key;
    const picked = setPick(state, bob, '2003-03-05', '6');
    const { schedule, itemKeyAt } = airingOf(picked, library, TODAY)!;
    const week = buildWeekModel(schedule, library, WEEK, { settings: NO_ADS, durationOf, today: TODAY, itemKeyAt });
    const bobs = week.days[2]!.airings.filter((airing) => airing.showId === 'bob');
    expect(bobs.map((airing) => [airing.label, airing.pinned, airing.itemKey])).toEqual([
      ['Ep. 6', true, bob],
      ['Ep. 7', false, bob],
    ]);
  });

  it('is pickable only from today on, and only when the item is known', async () => {
    const { library, state } = await setup();
    const { schedule, itemKeyAt } = airingOf(state, library, '2003-03-05')!;
    const week = buildWeekModel(schedule, library, WEEK, { settings: NO_ADS, durationOf, today: '2003-03-05', itemKeyAt });
    expect(week.days.slice(0, 5).map((day) => day.airings.every((airing) => airing.editable))).toEqual([false, false, true, true, true]);
    expect(week.days[2]!.today).toBe(true);
    // The wizard has no editor items: nothing to pick.
    const plain = buildWeekModel(schedule, library, WEEK, { settings: NO_ADS, durationOf, today: '2003-03-05' });
    expect(plain.days.flatMap((day) => day.airings).some((airing) => airing.editable || airing.itemKey !== undefined)).toBe(false);
  });
});

describe('episodes in the "não passar" list', () => {
  it('marks a blocked episode that airs because it was picked', async () => {
    const { library, state } = await setup({ 'nao-passar.yaml': 'episodios:\n  dbz: [2, 4]\n' });
    const week = buildWeekModel(airingOf(state, library, TODAY)!.schedule, library, WEEK, { settings: NO_ADS, durationOf, today: TODAY });
    // The engine skips 2 and 4 by itself.
    expect(week.days.flatMap((day) => day.airings).some((airing) => airing.blocked)).toBe(false);

    const picked = setPick(state, state.blocks[0]!.items[0]!.key, '2003-03-04', '2');
    const { schedule, itemKeyAt } = airingOf(picked, library, TODAY)!;
    const again = buildWeekModel(schedule, library, WEEK, { settings: NO_ADS, durationOf, today: TODAY, itemKeyAt });
    const first = again.days[1]!.airings[0]!;
    expect(first).toMatchObject({ label: 'Ep. 2', blocked: true, pinned: true });
    expect(again.days[1]!.airings.filter((airing) => airing.blocked)).toHaveLength(1);
  });
});

describe('the words of an airing', () => {
  it('uses the place in the show for an episode with no number', () => {
    expect(airingLabel(12, null, 11)).toBe('Ep. 12');
    expect(airingLabel(3, 'temporada-02', 20)).toBe('T2 · Ep. 3');
    expect(airingLabel(null, null, 2)).toBe('#3');
  });
});
