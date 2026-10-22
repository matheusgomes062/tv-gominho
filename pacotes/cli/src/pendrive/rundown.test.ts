import { scanLibrary, type LibrarySource, type Library } from '@tv-gominho/nucleo';
import { describe, expect, it } from 'vitest';
import { airingDates, buildRundown, chooseFps, planTimelines, type DurationSource, type RundownSettings } from './rundown';

// 2026-10-12 is a Monday.
const DAYS = `
nome: Teste
data_inicio: 2026-10-05
dias: [seg, ter, qua, qui, sex]
blocos:
  - horario: "08:00"
    itens:
      - vinheta: aberturas
      - programa: turma
  - horario: "12:00"
    itens:
      - programa: pixel
`;

const FILES: Record<string, string> = {
  'grades/teste.yaml': DAYS,
  'programas/turma/programa.yaml': 'titulo: A Turma',
  'programas/turma/episodios/001.mp4': '',
  'programas/turma/episodios/002.mp4': '',
  'programas/turma/episodios/003.mp4': '',
  'programas/turma/episodios.yaml': '"002":\n  titulo: Segundo\n  intervalos: ["1:00", "2:30"]\n',
  'programas/pixel/programa.yaml': 'titulo: Pixel',
  'programas/pixel/episodios/001.mp4': '',
  'programas/pixel/episodios/002.mp4': '',
  'vinhetas/aberturas/abertura.mp4': '',
  'vinhetas/comerciais/a.mp4': '',
  'vinhetas/comerciais/b.mp4': '',
};

const DURATIONS: Record<string, number> = {
  'programas/turma/episodios/001.mp4': 200,
  'programas/turma/episodios/002.mp4': 200.4,
  'programas/turma/episodios/003.mp4': 200,
  'programas/pixel/episodios/001.mp4': 100,
  'programas/pixel/episodios/002.mp4': 100,
  'vinhetas/aberturas/abertura.mp4': 8,
  'vinhetas/comerciais/a.mp4': 15,
  'vinhetas/comerciais/b.mp4': 20,
};

const source = (files: Record<string, string>): LibrarySource => ({
  files: Object.keys(files),
  readText: async (path) => files[path]!,
});

const durations = (table: Record<string, number> = DURATIONS): DurationSource => ({
  load: async () => undefined,
  get: (path) => table[path],
});

const SETTINGS: RundownSettings = { interstitials: true, commercials: true, adBreaks: { every: 8, ads: 2, afterEpisode: true, bumpers: true } };

async function load(files = FILES): Promise<Library> {
  return scanLibrary(source(files));
}

async function rundownOf(from: string, count: number, settings = SETTINGS, fps = 30, library?: Library, table?: Record<string, number>) {
  const lib = library ?? (await load());
  const schedule = lib.schedules[0]!;
  const dates = airingDates(schedule, from, count);
  const timelines = await planTimelines(schedule, lib, dates, settings, durations(table));
  return buildRundown(timelines, fps);
}

describe('airingDates', () => {
  it('starts on the day itself when the schedule airs then, and skips days off', async () => {
    const schedule = (await load()).schedules[0]!;
    expect(airingDates(schedule, '2026-10-15', 4)).toEqual(['2026-10-15', '2026-10-16', '2026-10-19', '2026-10-20']);
  });

  it('starts on the next airing day when the first day is off', async () => {
    const schedule = (await load()).schedules[0]!;
    expect(airingDates(schedule, '2026-10-17', 2)).toEqual(['2026-10-19', '2026-10-20']); // a Saturday
    expect(airingDates(schedule, '2026-10-18', 1)).toEqual(['2026-10-19']); // a Sunday
  });
});

describe('rundown', () => {
  it('advances the episodes from one airing day to the next, like the app', async () => {
    const rundown = await rundownOf('2026-10-16', 3); // Friday, Monday, Tuesday
    const turma = rundown.days.map((day) => day.pieces.find((piece) => piece.path.includes('turma'))!.path);
    // Mon 12, Tue 13, Wed 14, Thu 15, Fri 16: the 5th airing since 2026-10-05's week is 004 -> wraps; just check they all differ in sequence.
    expect(new Set(turma).size).toBe(3);
    expect(turma[1]).not.toBe(turma[0]);
  });

  it('airs the episode picked in the agenda and continues from it', async () => {
    const agenda = '\nagenda:\n  2026-10-13:\n    - bloco: "08:00"\n      item: 2\n      episodio: 2\n';
    const library = await load({ ...FILES, 'grades/teste.yaml': DAYS + agenda });
    const rundown = await rundownOf('2026-10-12', 3, SETTINGS, 30, library); // Monday to Wednesday
    const turma = rundown.days.map((day) => day.pieces.find((piece) => piece.path.includes('turma'))!.path.slice(-7));
    // Without the pick it would be 003, 001, 002: the Tuesday is 002 and the Wednesday goes on from it.
    expect(turma).toEqual(['003.mp4', '002.mp4', '003.mp4']);
  });

  it('skips the episodes of nao-passar.yaml, so the rundown never has them', async () => {
    const library = await load({ ...FILES, 'nao-passar.yaml': 'episodios:\n  turma: [3]\n' });
    const rundown = await rundownOf('2026-10-12', 3, SETTINGS, 30, library); // Monday to Wednesday
    const turma = rundown.days.map((day) => day.pieces.find((piece) => piece.path.includes('turma'))!.path.slice(-7));
    // Without the list it would be 003, 001, 002: the sequence now runs over 001 and 002 only.
    expect(turma).toEqual(['002.mp4', '001.mp4', '002.mp4']);
  });

  it('starts every day with its first block and skips the gap to the next block (do_inicio)', async () => {
    const { days } = await rundownOf('2026-10-12', 1);
    const paths = days[0]!.pieces.map((piece) => piece.path);
    expect(paths[0]).toBe('vinhetas/aberturas/abertura.mp4');
    // 08:00 block, then straight into the 12:00 block: no filler for the 3h gap, and the offsets are continuous.
    expect(paths.some((path) => path.includes('pixel'))).toBe(true);
    let expected = 0;
    for (const piece of days[0]!.pieces) {
      expect(piece.offset).toBeCloseTo(expected, 6);
      expected += piece.seconds;
    }
    expect(days[0]!.seconds).toBeCloseTo(expected, 6);
  });

  it('cuts an episode at its own break points and maps the parts to file ranges', async () => {
    // Wednesday plays episode 002, which breaks at 1:00 and 2:30.
    const { days } = await rundownOf('2026-10-14', 1, SETTINGS, 30);
    const acts = days[0]!.pieces.filter((piece) => piece.path.endsWith('turma/episodios/002.mp4'));
    expect(acts).toHaveLength(3);
    expect(acts.map((act) => act.act)).toEqual([
      { index: 1, count: 3 },
      { index: 2, count: 3 },
      { index: 3, count: 3 },
    ]);
    // File ranges in frames: [0, 1800) [1800, 4500) [4500, round(200.4 * 30) = 6012)
    expect(acts.map((act) => [act.startFrame, act.startFrame + act.frames])).toEqual([
      [0, 1800],
      [1800, 4500],
      [4500, 6012],
    ]);
    // Between two acts there is a break of 2 commercials, flagged as such.
    const pieces = days[0]!.pieces;
    const firstAct = pieces.indexOf(acts[0]!);
    expect(pieces[firstAct + 1]).toMatchObject({ role: 'comercial', inBreak: true });
    expect(pieces[firstAct + 2]).toMatchObject({ role: 'comercial', inBreak: true });
    expect(pieces[firstAct + 3]).toBe(acts[1]);
  });

  it('puts a break after every episode and none when commercials are off', async () => {
    const withAds = await rundownOf('2026-10-12', 1);
    const last = withAds.days[0]!.pieces.at(-1)!;
    expect(last).toMatchObject({ role: 'comercial', inBreak: true });

    const without = await rundownOf('2026-10-12', 1, { ...SETTINGS, commercials: false });
    const pieces = without.days[0]!.pieces;
    expect(pieces.some((piece) => piece.role === 'comercial')).toBe(false);
    expect(pieces.filter((piece) => piece.role === 'episodio')).toHaveLength(2);
  });

  it('frames each break with the brand bumpers, as vinheta pieces inside the break', async () => {
    const lib = await load({
      ...FILES,
      'vinhetas/intervalos/marca/entrada.mp4': '',
      'vinhetas/intervalos/marca/saida.mp4': '',
    });
    const table = { ...DURATIONS, 'vinhetas/intervalos/marca/entrada.mp4': 4, 'vinhetas/intervalos/marca/saida.mp4': 6 };
    const { days } = await rundownOf('2026-10-14', 1, SETTINGS, 30, lib, table);
    const pieces = days[0]!.pieces;
    const entrada = pieces.findIndex((piece) => piece.path.endsWith('marca/entrada.mp4'));
    expect(entrada).toBeGreaterThan(0);
    expect(pieces[entrada]).toMatchObject({ role: 'vinheta', inBreak: true, frames: 120 });
    expect(pieces[entrada + 1]).toMatchObject({ role: 'comercial', inBreak: true });
    expect(pieces[entrada + 2]).toMatchObject({ role: 'comercial', inBreak: true });
    expect(pieces[entrada + 3]).toMatchObject({ role: 'vinheta', inBreak: true, frames: 180 });
    expect(pieces[entrada + 3]!.path).toContain('saida');

    const off = await rundownOf('2026-10-14', 1, { ...SETTINGS, adBreaks: { ...SETTINGS.adBreaks, bumpers: false } }, 30, lib, table);
    expect(off.days[0]!.pieces.some((piece) => piece.path.includes('/marca/'))).toBe(false);
  });

  it('drops the bumpers with --sem-vinhetas but keeps episodes and commercials', async () => {
    const { days } = await rundownOf('2026-10-12', 1, { ...SETTINGS, interstitials: false });
    expect(days[0]!.pieces.some((piece) => piece.role === 'vinheta')).toBe(false);
    expect(days[0]!.pieces.some((piece) => piece.role === 'comercial')).toBe(true);
  });

  it('honours a different break interval', async () => {
    const lib = await load({ ...FILES, 'programas/turma/episodios.yaml': '' });
    const long = { ...DURATIONS, 'programas/turma/episodios/003.mp4': 600 }; // Monday plays episode 003
    const turmaActs = (rundown: Awaited<ReturnType<typeof rundownOf>>) => rundown.days[0]!.pieces.filter((piece) => piece.path.endsWith('turma/episodios/003.mp4'));
    // Every 5 minutes of a 10-minute episode: 2 breaks, 3 equal acts of 200 s.
    const every5 = await rundownOf('2026-10-12', 1, { ...SETTINGS, adBreaks: { every: 5, ads: 1, afterEpisode: false, bumpers: true } }, 30, lib, long);
    expect(turmaActs(every5).map((act) => act.frames)).toEqual([6000, 6000, 6000]);
    // 0 turns the breaks inside the episode off.
    const none = await rundownOf('2026-10-12', 1, { ...SETTINGS, adBreaks: { every: 0, ads: 1, afterEpisode: false, bumpers: true } }, 30, lib, long);
    expect(turmaActs(none)).toHaveLength(1);
  });

  it('keeps the acts of an episode gapless and overlap-free whatever the frame rate', async () => {
    for (const fps of [25, 30]) {
      const { days } = await rundownOf('2026-10-14', 1, SETTINGS, fps);
      const acts = days[0]!.pieces.filter((piece) => piece.path.endsWith('turma/episodios/002.mp4'));
      for (let i = 1; i < acts.length; i++) expect(acts[i]!.startFrame).toBe(acts[i - 1]!.startFrame + acts[i - 1]!.frames);
      expect(acts.reduce((sum, act) => sum + act.frames, 0)).toBe(Math.round(200.4 * fps));
    }
  });

  it('lists unreadable files and renders everything else', async () => {
    const lib = await load();
    const schedule = lib.schedules[0]!;
    const table = { ...DURATIONS };
    delete table['programas/pixel/episodios/001.mp4'];
    delete table['programas/pixel/episodios/002.mp4'];
    const timelines = await planTimelines(schedule, lib, airingDates(schedule, '2026-10-12', 1), SETTINGS, durations(table));
    const rundown = buildRundown(timelines, 30);
    expect(rundown.skipped.some((path) => path.includes('pixel'))).toBe(true);
    expect(rundown.days[0]!.pieces.some((piece) => piece.path.includes('pixel'))).toBe(false);
    expect(rundown.days[0]!.pieces.some((piece) => piece.path.includes('turma'))).toBe(true);
  });

  it('gives every piece a title for the console', async () => {
    const { days } = await rundownOf('2026-10-12', 1);
    const titles = days[0]!.pieces.map((piece) => piece.title);
    expect(titles[0]).toBe('abertura');
    expect(titles.some((title) => title.startsWith('A Turma: '))).toBe(true);
  });
});

describe('chooseFps', () => {
  it('follows the majority of the video, by duration', () => {
    expect(chooseFps([{ fps: 25, seconds: 1000 }, { fps: 29.97, seconds: 100 }])).toBe(25);
    expect(chooseFps([{ fps: 25, seconds: 100 }, { fps: 29.97, seconds: 1000 }])).toBe(30);
    expect(chooseFps([{ fps: 24, seconds: 1000 }])).toBe(25);
    expect(chooseFps([{ fps: 23.976, seconds: 1000 }, { fps: 30, seconds: 10 }])).toBe(25);
    expect(chooseFps([{ fps: 50, seconds: 1000 }])).toBe(25);
    expect(chooseFps([{ fps: 59.94, seconds: 1000 }])).toBe(30);
  });

  it('uses 30 when nothing is known or the frame rates tie', () => {
    expect(chooseFps([])).toBe(30);
    expect(chooseFps([{ fps: null, seconds: 100 }])).toBe(30);
    expect(chooseFps([{ fps: 25, seconds: 100 }, { fps: 30, seconds: 100 }])).toBe(30);
  });
});
