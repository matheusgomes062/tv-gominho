import { describe, expect, it } from 'vitest';
import { buildTimeline, locate, planDay, type DayPlan } from './engine';
import { scheduleToYaml } from './generate';
import { scanLibrary } from './library';
import { resolveFromStart, resolveReal, type TimelineOf } from './modes';
import { parseSchedule } from './schedule';
import { memorySource } from './test-helpers';
import type { Library, LibraryWarning, Schedule } from './types';

// 2003-03-03 was a Monday. dbz airs twice a day (items 2 of 08:00 and 1 of 10:00), bob twice in a row.
const BLOCKS = `
nome: Teste
data_inicio: 2003-03-03
dias: [seg, ter, qua, qui, sex]
blocos:
  - horario: "08:00"
    itens:
      - vinheta: aberturas
      - programa: dbz
      - comerciais: 1
      - programa: bob
        episodios: 2
  - horario: "10:00"
    itens:
      - programa: dbz
`;

const FILES: Record<string, string> = {
  'programas/dbz/programa.yaml': 'titulo: DBZ',
  'programas/dbz/episodios/001.mp4': '',
  'programas/dbz/episodios/002.mp4': '',
  'programas/dbz/episodios/003.mp4': '',
  'programas/dbz/episodios/004.mp4': '',
  'programas/dbz/episodios/005.mp4': '',
  'programas/bob/programa.yaml': 'titulo: Bob',
  'programas/bob/episodios/001.mp4': '',
  'programas/bob/episodios/002.mp4': '',
  'programas/bob/episodios/003.mp4': '',
  'programas/serie/programa.yaml': 'titulo: Serie',
  'programas/serie/episodios/temporada-01/001.mp4': '',
  'programas/serie/episodios/temporada-01/002.mp4': '',
  'programas/serie/episodios/temporada-02/001.mp4': '',
  'programas/sorte/programa.yaml': 'titulo: Sorte\nordem: aleatoria',
  'programas/sorte/episodios/001.mp4': '',
  'programas/sorte/episodios/002.mp4': '',
  'programas/sorte/episodios/003.mp4': '',
  'programas/sorte/episodios/004.mp4': '',
  'vinhetas/aberturas/a1.mp4': '',
  'vinhetas/comerciais/c1.mp4': '',
  'vinhetas/comerciais/c2.mp4': '',
};

/** The grade with an `agenda` section on the end (none when `agenda` is empty), scanned with its warnings. */
async function setup(agenda = '', blocks = BLOCKS) {
  const lib = await scanLibrary(memorySource({ ...FILES, 'grades/teste.yaml': blocks + agenda }));
  return { lib, grade: lib.schedules[0]!, messages: lib.warnings.map((w) => w.message) };
}

const episodes = (plan: DayPlan, show?: string) =>
  plan.blocks
    .flatMap((b) => b.items)
    .flatMap((item) => (item.kind === 'episode' && (!show || item.show.id === show) ? [item.episodeIndex + 1] : []));

const days = (lib: Library, grade: Schedule, dates: string[], show = 'dbz') => dates.map((date) => episodes(planDay(grade, lib, date), show));

const WEEK = ['2003-03-03', '2003-03-04', '2003-03-05', '2003-03-06', '2003-03-07', '2003-03-10'];

describe('agenda', () => {
  it('without an agenda every episode follows the count from data_inicio, as always', async () => {
    const { lib, grade, messages } = await setup();
    expect(messages).toEqual([]);
    expect(grade.agenda).toBeUndefined();
    expect(days(lib, grade, WEEK)).toEqual([[1, 2], [3, 4], [5, 1], [2, 3], [4, 5], [1, 2]]);
    expect(days(lib, grade, WEEK, 'bob')).toEqual([[1, 2], [3, 1], [2, 3], [1, 2], [3, 1], [2, 3]]);
    // An empty section changes nothing either.
    const empty = await setup('agenda: {}\n');
    expect(empty.messages).toEqual([]);
    expect(days(empty.lib, empty.grade, WEEK)).toEqual(days(lib, grade, WEEK));
  });

  it('airs the picked episode on its date and nothing else changes that day', async () => {
    const { lib, grade, messages } = await setup(`
agenda:
  2003-03-05:
    - bloco: "08:00"
      item: 2
      episodio: 4
`);
    expect(messages).toEqual([]);
    const plan = planDay(grade, lib, '2003-03-05');
    // The first dbz airing is the pick; the second one just follows it. bob is untouched.
    expect(episodes(plan, 'dbz')).toEqual([4, 5]);
    expect(episodes(plan, 'bob')).toEqual([2, 3]);
    // Days before the pick are as before.
    expect(days(lib, grade, WEEK.slice(0, 2))).toEqual([[1, 2], [3, 4]]);
  });

  it('continues from the picked episode on the next airings, wrapping at the end', async () => {
    const { lib, grade } = await setup(`
agenda:
  2003-03-05:
    - bloco: "08:00"
      item: 2
      episodio: 4
`);
    // 4 and 5 on the pick day, then 1, 2 | 3, 4 | 5, 1: the week goes on from there.
    expect(days(lib, grade, WEEK)).toEqual([[1, 2], [3, 4], [4, 5], [1, 2], [3, 4], [5, 1]]);
    // A day off reruns the last airing day, pick included.
    expect(episodes(planDay(grade, lib, '2003-03-09'), 'dbz')).toEqual([3, 4]);
  });

  it('follows the latest of several picks', async () => {
    const { lib, grade, messages } = await setup(`
agenda:
  2003-03-06:
    - bloco: "10:00"
      item: 1
      episodio: 5
  2003-03-04:
    - bloco: "08:00"
      item: 2
      episodio: 2
`);
    expect(messages).toEqual([]);
    expect(grade.agenda!.map((pick) => pick.date)).toEqual(['2003-03-04', '2003-03-06']);
    expect(days(lib, grade, WEEK)).toEqual([[1, 2], [2, 3], [4, 5], [1, 5], [1, 2], [3, 4]]);
  });

  it('lets two picks of the same day pick both airings of a show', async () => {
    const { lib, grade, messages } = await setup(`
agenda:
  2003-03-04:
    - bloco: "10:00"
      item: 1
      episodio: 1
    - bloco: "08:00"
      item: 2
      episodio: 5
`);
    expect(messages).toEqual([]);
    expect(days(lib, grade, ['2003-03-04', '2003-03-05'])).toEqual([[5, 1], [2, 3]]);
  });

  it('picks the first of an item with episodios: N and the others follow it', async () => {
    const { lib, grade, messages } = await setup(`
agenda:
  2003-03-04:
    - bloco: "08:00"
      item: 4
      episodio: 2
`);
    expect(messages).toEqual([]);
    expect(days(lib, grade, WEEK.slice(0, 4), 'bob')).toEqual([[1, 2], [2, 3], [1, 2], [3, 1]]);
    // dbz has its own count.
    expect(days(lib, grade, WEEK.slice(0, 2))).toEqual([[1, 2], [3, 4]]);
  });

  it('airs the pick in every horario mode', async () => {
    const { lib, grade } = await setup(`
agenda:
  2003-03-05:
    - bloco: "08:00"
      item: 2
      episodio: 4
`);
    const episodeOf = (timeline: ReturnType<typeof buildTimeline>, index: number) => {
      const item = timeline.entries[index]!.item;
      return item?.kind === 'episode' ? `${item.show.id}#${item.episodeIndex + 1}` : 'not an episode';
    };
    const build = (options: { keepLongGaps?: boolean; maxGapFill?: number }): TimelineOf => (date) =>
      buildTimeline(planDay(grade, lib, date), () => 100, options);

    // continuo: the day's timeline loops; the opening takes 08:00-08:01:40, dbz comes next.
    const continuous = buildTimeline(planDay(grade, lib, '2003-03-05'), () => 100);
    expect(episodeOf(continuous, locate(continuous, 8 * 3600 + 150)!.index)).toBe('dbz#4');

    // real: at 08:02 of the day.
    const real = await resolveReal(grade, '2003-03-05', 8 * 3600 + 120, build({ keepLongGaps: true }));
    expect(real!.offAir).toBe(false);
    if (!real!.offAir) expect(episodeOf(real!.timeline, real!.index)).toBe('dbz#4');

    // do_inicio: a marathon that starts that day, and the next day goes on from the pick.
    const marathon = build({ maxGapFill: 0 });
    const start = await resolveFromStart(grade, '2003-03-05', 150, marathon);
    expect(episodeOf(start!.timeline, start!.index)).toBe('dbz#4');
    const length = start!.timeline.end - start!.timeline.start;
    const next = await resolveFromStart(grade, '2003-03-05', length + 150, marathon);
    expect(next!.date).toBe('2003-03-06');
    expect(episodeOf(next!.timeline, next!.index)).toBe('dbz#1');
  });

  it('obeys a pick on a show with ordem: aleatoria without disturbing the other draws of the day', async () => {
    const random = BLOCKS.replace('- programa: dbz\n      - comerciais: 1', '- programa: sorte\n        episodios: 2\n      - comerciais: 1');
    const plain = await setup('', random);
    const picked = await setup(
      `
agenda:
  2003-03-04:
    - bloco: "08:00"
      item: 2
      episodio: 3
`,
      random,
    );
    expect(picked.messages).toEqual([]);
    const a = planDay(plain.grade, plain.lib, '2003-03-04');
    const b = planDay(picked.grade, picked.lib, '2003-03-04');
    expect(episodes(b, 'sorte').slice(0, 2)).toEqual([3, 4]);
    // Everything but the pinned episodes is as it was.
    const others = (plan: DayPlan) => plan.blocks.flatMap((block) => block.items).filter((item) => item.kind !== 'episode' || item.show.id !== 'sorte');
    expect(others(b)).toEqual(others(a));
    // And a later day draws again, like it would have.
    expect(planDay(picked.grade, picked.lib, '2003-03-05')).toEqual(planDay(plain.grade, plain.lib, '2003-03-05'));
  });

  it('picks by season when the numbers repeat', async () => {
    const blocks = BLOCKS.replace('- programa: bob\n        episodios: 2', '- programa: serie');
    const { lib, grade, messages } = await setup(
      `
agenda:
  2003-03-04:
    - bloco: "08:00"
      item: 4
      episodio: temporada-02/1
`,
      blocks,
    );
    expect(messages).toEqual([]);
    expect(episodes(planDay(grade, lib, '2003-03-04'), 'serie')).toEqual([3]);
    // Day 3 continues after it and wraps.
    expect(episodes(planDay(grade, lib, '2003-03-05'), 'serie')).toEqual([1]);
  });
});

describe('agenda warnings', () => {
  const ignored = async (agenda: string, blocks = BLOCKS) => {
    const result = await setup(agenda, blocks);
    // The grade works exactly as without the agenda.
    const plain = await setup('', blocks);
    expect(result.grade.agenda).toBeUndefined();
    expect(days(result.lib, result.grade, WEEK)).toEqual(days(plain.lib, plain.grade, WEEK));
    return result.messages;
  };

  it('warns about a bad date and about a day the grade does not air', async () => {
    const pick = `    - bloco: "08:00"\n      item: 2\n      episodio: 4\n`;
    expect(await ignored(`agenda:\n  "05/03/2003":\n${pick}`)).toEqual([expect.stringMatching(/05\/03\/2003: data inválida.*AAAA-MM-DD/)]);
    expect(await ignored(`agenda:\n  2003-02-30:\n${pick}`)).toEqual([expect.stringMatching(/2003-02-30: data inválida/)]);
    // 2003-03-08 is a Saturday.
    expect(await ignored(`agenda:\n  2003-03-08:\n${pick}`)).toEqual([expect.stringMatching(/2003-03-08.*sab.*não está em "dias"/)]);
  });

  it('warns about a block that does not exist and about an item that is not a show', async () => {
    const at = (bloco: string, item: number) => `agenda:\n  2003-03-05:\n    - bloco: ${bloco}\n      item: ${item}\n      episodio: 4\n`;
    expect(await ignored(at('"09:00"', 2))).toEqual([expect.stringMatching(/não há bloco "09:00"/)]);
    expect(await ignored(at('manhã', 2))).toEqual([expect.stringMatching(/não há bloco "manhã"/)]);
    expect(await ignored(at('"08:00"', 1))).toEqual([expect.stringMatching(/item 1 do bloco 08:00 não é um "programa"/)]);
    expect(await ignored(at('"08:00"', 3))).toEqual([expect.stringMatching(/item 3.*não é um "programa"/)]);
    expect(await ignored(at('"08:00"', 9))).toEqual([expect.stringMatching(/item 9.*não existe/)]);
    expect(await ignored(at('"08:00"', 0))).toEqual([expect.stringMatching(/"item" deve ser a posição/)]);
  });

  it('warns about an episode the show does not have, or that is ambiguous', async () => {
    const at = (episodio: string, item = 2) => `agenda:\n  2003-03-05:\n    - bloco: "08:00"\n      item: ${item}\n      episodio: ${episodio}\n`;
    expect(await ignored(at('99'))).toEqual([expect.stringMatching(/Agenda de 2003-03-05, 08:00, item 2: o programa "dbz" não tem o episódio 99/)]);
    expect(await ignored(at('banana'))).toEqual([expect.stringMatching(/"episodio" deve ser o número/)]);
    const seasons = BLOCKS.replace('- programa: bob\n        episodios: 2', '- programa: serie');
    expect(await ignored(at('1', 4), seasons)).toEqual([expect.stringMatching(/mais de um episódio 1.*temporada-01\/1/)]);
    expect(await ignored(at('temporada-03/1', 4), seasons)).toEqual([expect.stringMatching(/não tem o episódio temporada-03\/1/)]);
  });

  it('warns about a section or entry in the wrong shape and keeps the valid entries', async () => {
    expect(await ignored('agenda: 2003-03-05\n')).toEqual([expect.stringMatching(/"agenda" deve ser uma lista de datas/)]);
    expect(await ignored('agenda:\n  2003-03-05: 12\n')).toEqual([expect.stringMatching(/deve ser uma lista de escolhas/)]);
    expect(await ignored('agenda:\n  2003-03-05:\n    - 12\n')).toEqual([expect.stringMatching(/formato inválido/)]);

    const { lib, grade, messages } = await setup(`
agenda:
  2003-03-05:
    - bloco: "08:00"
      item: 1
      episodio: 4
    - bloco: "08:00"
      item: 2
      episodio: 4
    - bloco: "08:00"
      item: 2
      episodio: 1
`);
    expect(messages).toHaveLength(2);
    expect(messages[1]).toMatch(/escolha 3: esse item já tem um episódio escolhido nessa data. Vale o primeiro/);
    expect(days(lib, grade, WEEK)[2]).toEqual([4, 5]);
  });

  it('counts item positions as written in the file, even above an item that was skipped', async () => {
    const blocks = BLOCKS.replace('      - vinheta: aberturas', '      - algo: estranho\n      - vinheta: aberturas');
    const { lib, grade, messages } = await setup(
      `
agenda:
  2003-03-05:
    - bloco: "08:00"
      item: 3
      episodio: 4
`,
      blocks,
    );
    // Only the odd item is reported: the pick still finds dbz, now the third line.
    expect(messages).toEqual([expect.stringMatching(/item desconhecido/)]);
    expect(days(lib, grade, WEEK)[2]).toEqual([4, 5]);
  });
});

describe('agenda round trip', () => {
  const write = (schedule: Schedule) => scheduleToYaml({ schedule, estimates: schedule.blocks.map(() => 0), itemStarts: new Map() });
  const read = (text: string) => {
    const warnings: LibraryWarning[] = [];
    const schedule = parseSchedule('grades/teste.yaml', text, warnings);
    expect(warnings).toEqual([]);
    return schedule!;
  };

  it('reads, writes and reads again to the same grade', () => {
    const first = read(`${BLOCKS}
agenda:
  2003-03-06:
    - bloco: "10:00"
      item: 1
      episodio: "012"
  2003-03-04:
    - bloco: 08:00
      item: 4
      episodio: temporada-02/1
    - bloco: "08:00"
      item: 2
      episodio: 4
`);
    expect(first.agenda).toEqual([
      { date: '2003-03-04', blockStart: 8 * 3600, item: 2, episode: '4' },
      { date: '2003-03-04', blockStart: 8 * 3600, item: 4, episode: 'temporada-02/1' },
      { date: '2003-03-06', blockStart: 10 * 3600, item: 1, episode: '12' },
    ]);
    const yaml = write(first);
    expect(yaml).toContain('agenda:');
    expect(yaml).toContain('item: 2   # dbz');
    expect(read(yaml)).toEqual(first);
    expect(write(read(yaml))).toBe(yaml);
  });

  it('writes no agenda section for a grade without one', () => {
    expect(write(read(BLOCKS))).not.toContain('agenda');
  });
});
