import { describe, expect, it } from 'vitest';
import { buildTimeline, planDay, requiredPaths } from './engine';
import { scanLibrary } from './library';
import { formatSpan, previewDay } from './preview';
import { DEFAULT_SETTINGS, channelAdBreaks } from './settings';
import { memorySource } from './test-helpers';

// The preview shows what the TV will air: the same planDay + buildTimeline, with the channel's break rules.

const grade = (blocks: string, extra = '') => `
nome: Teste
data_inicio: 2003-03-03
dias: [seg, ter]
${extra}
blocos:
${blocks}
`;

const TWO_BLOCKS = (second: string) => `  - horario: "08:00"
    itens:
      - programa: dbz
        episodios: 2
  - horario: "${second}"
    itens:
      - programa: dbz
`;

const FILES: Record<string, string> = {
  'programas/dbz/programa.yaml': 'titulo: DBZ',
  'programas/dbz/episodios/001 - Um.mp4': '',
  'programas/dbz/episodios/002 - Dois.mp4': '',
  'programas/dbz/episodios/003 - Tres.mp4': '',
  'programas/dbz/episodios/004 - Quatro.mp4': '',
  'vinhetas/comerciais/a.mp4': '',
  'vinhetas/comerciais/b.mp4': '',
  'vinhetas/intervalos/marca/entrada.mp4': '',
  'vinhetas/intervalos/marca/saida.mp4': '',
};

const NO_ADS = { ...DEFAULT_SETTINGS, commercials: false };
const EPISODE = 22 * 60;
const known = (path: string) => (path.includes('/episodios/') ? EPISODE : 30);

async function setup(blocks: string, extra = '') {
  const library = await scanLibrary(memorySource({ ...FILES, 'grades/teste.yaml': grade(blocks, extra) }));
  return { library, schedule: library.schedules[0]! };
}

describe('previewDay', () => {
  it('lists the episode of each show item with its start, from the same plan the TV uses', async () => {
    const { library, schedule } = await setup(TWO_BLOCKS('10:00'));
    const preview = previewDay(schedule, library, '2003-03-03', { settings: NO_ADS, durationOf: known });

    expect(preview.airs).toBe(true);
    expect(preview.estimated).toBe(false);
    expect(preview.rows.map((row) => [row.block, row.start, row.episode.number])).toEqual([
      [0, 8 * 3600, 1],
      [0, 8 * 3600 + EPISODE, 2],
      [1, 10 * 3600, 3],
    ]);
    expect(preview.rows[1]!.end).toBe(8 * 3600 + 2 * EPISODE);

    // Same episodes as planDay, same layout as buildTimeline.
    const plan = planDay(schedule, library, '2003-03-03', { commercials: false });
    const fromPlan = plan.blocks.flatMap((block) => block.items.flatMap((item) => (item.kind === 'episode' ? [item.episodeIndex] : [])));
    expect(preview.rows.map((row) => row.episodeIndex)).toEqual(fromPlan);
    // The files to measure first are the plan's: the episodes of the rows are among them.
    expect(preview.paths.sort()).toEqual(requiredPaths(plan).sort());
    expect(preview.paths).toContain('programas/dbz/episodios/001 - Um.mp4');
  });

  it('continues the episodes on the next airing day', async () => {
    const { library, schedule } = await setup(TWO_BLOCKS('10:00'));
    const tuesday = previewDay(schedule, library, '2003-03-04', { settings: NO_ADS, durationOf: known });
    expect(tuesday.rows.map((row) => row.episode.number)).toEqual([4, 1, 2]);
  });

  it('counts the breaks of the channel in the times, with its own rules over the general ones', async () => {
    const { library, schedule } = await setup('  - horario: "08:00"\n    itens:\n      - programa: dbz\n');
    const general = previewDay(schedule, library, '2003-03-03', { settings: DEFAULT_SETTINGS, durationOf: known });
    const noBreaks = { ...schedule, adBreaks: { every: 0, afterEpisode: false } };
    const own = previewDay(noBreaks, library, '2003-03-03', { settings: DEFAULT_SETTINGS, durationOf: known });

    expect(own.rows[0]!.end - own.rows[0]!.start).toBe(EPISODE);
    // With the general rules the episode is cut (2 breaks of 3 ads) and runs longer.
    expect(general.rows[0]!.end - general.rows[0]!.start).toBeGreaterThan(EPISODE + 2 * 3 * 30 - 1);
    // Exactly what buildTimeline does.
    const plan = planDay(schedule, library, '2003-03-03');
    const timeline = buildTimeline(plan, known, { keepLongGaps: true, adBreaks: channelAdBreaks(DEFAULT_SETTINGS, schedule) });
    const episodes = timeline.entries.filter((entry) => entry.kind === 'episode');
    expect(general.rows[0]!.start).toBe(episodes[0]!.start);
    expect(general.rows[0]!.end).toBe(episodes.at(-1)!.start + episodes.at(-1)!.duration);
  });

  it('turns the commercials off with the general switch, whatever the channel says', async () => {
    const { library, schedule } = await setup('  - horario: "08:00"\n    itens:\n      - programa: dbz\n', 'intervalos:\n  comerciais: 5\n  a_cada: 4\n');
    const preview = previewDay(schedule, library, '2003-03-03', { settings: NO_ADS, durationOf: known });
    expect(preview.rows[0]!.end - preview.rows[0]!.start).toBe(EPISODE);
  });

  it('uses typical lengths for videos not measured yet and says so', async () => {
    const { library, schedule } = await setup(TWO_BLOCKS('10:00'));
    const preview = previewDay(schedule, library, '2003-03-03', { settings: NO_ADS, durationOf: () => undefined });
    expect(preview.estimated).toBe(true);
    expect(preview.rows.map((row) => row.start)).toEqual([8 * 3600, 8 * 3600 + 22 * 60, 10 * 3600]);

    const partly = previewDay(schedule, library, '2003-03-03', { settings: NO_ADS, durationOf: (path) => (path.includes('002') ? undefined : known(path)) });
    expect(partly.estimated).toBe(true);
    expect(previewDay(schedule, library, '2003-03-03', { settings: NO_ADS, durationOf: known }).estimated).toBe(false);
  });

  it('warns when a block runs past the start of the next one', async () => {
    const { library, schedule } = await setup(TWO_BLOCKS('08:30'));
    const preview = previewDay(schedule, library, '2003-03-03', { settings: NO_ADS, durationOf: known });
    expect(preview.warnings).toHaveLength(1);
    expect(preview.warnings[0]).toMatchObject({ kind: 'overlap', block: 1, seconds: 14 * 60 });
    expect(preview.warnings[0]!.message).toContain('08:00');
    expect(preview.warnings[0]!.message).toContain('08:30');
    expect(preview.warnings[0]!.message).toContain('08:44');
    // The next block starts late, like on the air.
    expect(preview.rows.at(-1)!.start).toBe(8 * 3600 + 2 * EPISODE);
  });

  it('warns about a hole longer than the engine fills, and not about a small one', async () => {
    const big = await setup(TWO_BLOCKS('09:00'));
    const preview = previewDay(big.schedule, big.library, '2003-03-03', { settings: NO_ADS, durationOf: known });
    expect(preview.warnings).toHaveLength(1);
    expect(preview.warnings[0]).toMatchObject({ kind: 'gap', block: 1, seconds: 16 * 60 });
    expect(preview.warnings[0]!.message).toContain('08:44');

    const small = await setup(TWO_BLOCKS('08:50'));
    expect(previewDay(small.schedule, small.library, '2003-03-03', { settings: NO_ADS, durationOf: known }).warnings).toEqual([]);
    const exact = await setup(TWO_BLOCKS('08:44'));
    expect(previewDay(exact.schedule, exact.library, '2003-03-03', { settings: NO_ADS, durationOf: known }).warnings).toEqual([]);
  });

  it('is empty on a day the channel does not air', async () => {
    const { library, schedule } = await setup(TWO_BLOCKS('10:00'));
    const preview = previewDay(schedule, library, '2003-03-05', { settings: NO_ADS, durationOf: known });
    expect(preview).toMatchObject({ airs: false, rows: [], warnings: [], paths: [] });
  });

  it('gives the same answer every time', async () => {
    const { library, schedule } = await setup(TWO_BLOCKS('10:00'));
    const run = () => previewDay(schedule, library, '2003-03-03', { settings: DEFAULT_SETTINGS, durationOf: known });
    expect(run()).toEqual(run());
  });
});

describe('formatSpan', () => {
  it('writes hours and minutes', () => {
    expect(formatSpan(14 * 60)).toBe('14 min');
    expect(formatSpan(3600)).toBe('1 h');
    expect(formatSpan(2 * 3600 + 10 * 60)).toBe('2 h 10 min');
  });
});
