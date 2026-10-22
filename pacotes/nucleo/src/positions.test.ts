import { describe, expect, it } from 'vitest';
import { planDay, type DayPlan } from './engine';
import { scheduleToYaml } from './generate';
import { preservePositions } from './positions';
import { scanLibrary } from './library';
import { parseSchedule } from './schedule';
import { memorySource } from './test-helpers';
import type { Library, LibraryWarning, Schedule } from './types';

// 2003-03-03 was a Monday. In OLD, dbz airs twice a day and bob twice in a row, from the premiere: on the
// Wednesday 2003-03-05 (the edit date) dbz starts with episode 5 and bob with episode 2.
const header = (name: string) => `nome: ${name}\ndata_inicio: 2003-03-03\ndias: [seg, ter, qua, qui, sex]\n`;

const OLD = `${header('Antiga')}blocos:
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

// dbz three times a day (bob once), bob first.
const MORE_DBZ = `${header('Nova')}blocos:
  - horario: "08:00"
    itens:
      - programa: bob
      - programa: dbz
        episodios: 3
`;

// dbz once a day, bob three times, in another block order.
const MORE_BOB = `${header('Nova')}blocos:
  - horario: "09:00"
    itens:
      - programa: bob
        episodios: 3
  - horario: "14:00"
    itens:
      - programa: dbz
`;

const FILES: Record<string, string> = {
  'programas/dbz/programa.yaml': 'titulo: DBZ',
  ...Object.fromEntries([1, 2, 3, 4, 5].map((n) => [`programas/dbz/episodios/00${n}.mp4`, ''])),
  'programas/bob/programa.yaml': 'titulo: Bob',
  ...Object.fromEntries([1, 2, 3].map((n) => [`programas/bob/episodios/00${n}.mp4`, ''])),
  'programas/serie/programa.yaml': 'titulo: Serie',
  'programas/serie/episodios/temporada-01/001.mp4': '',
  'programas/serie/episodios/temporada-01/002.mp4': '',
  'programas/serie/episodios/temporada-02/001.mp4': '',
  'programas/sorte/programa.yaml': 'titulo: Sorte\nordem: aleatoria',
  ...Object.fromEntries([1, 2, 3, 4].map((n) => [`programas/sorte/episodios/00${n}.mp4`, ''])),
  'vinhetas/aberturas/a1.mp4': '',
  'vinhetas/comerciais/c1.mp4': '',
};

/** A library with OLD (grades/antiga.yaml) and the new grade (grades/nova.yaml), scanned with its warnings. */
async function setup(next: string, files: Record<string, string> = {}) {
  const lib = await scanLibrary(memorySource({ ...FILES, 'grades/antiga.yaml': OLD, 'grades/nova.yaml': next, ...files }));
  const grade = (id: string) => lib.schedules.find((schedule) => schedule.id === id)!;
  return { lib, old: grade('antiga'), next: grade('nova'), messages: lib.warnings.map((w) => w.message) };
}

const episodes = (plan: DayPlan, show: string) =>
  plan.blocks
    .flatMap((b) => b.items)
    .flatMap((item) => (item.kind === 'episode' && item.show.id === show ? [item.episodeIndex + 1] : []));

/** The episodes of `show` on each date. */
const days = (lib: Library, grade: Schedule, dates: string[], show: string) => dates.map((date) => episodes(planDay(grade, lib, date), show));

const EDIT = '2003-03-05';
const FROM_EDIT = ['2003-03-05', '2003-03-06', '2003-03-07', '2003-03-10'];

describe('preservePositions', () => {
  it('has each show go on from where the old grade was on the edit date, with more airings of dbz', async () => {
    const { lib, old, next } = await setup(MORE_DBZ);
    // The old grade has dbz at 5 and bob at 2 that day.
    expect(days(lib, old, [EDIT], 'dbz')).toEqual([[5, 1]]);
    expect(days(lib, old, [EDIT], 'bob')).toEqual([[2, 3]]);
    // Counted again with the new blocks, they would jump.
    expect(days(lib, next, [EDIT], 'dbz')).toEqual([[2, 3, 4]]);

    const kept = preservePositions(old, next, lib, EDIT);
    expect(days(lib, kept, FROM_EDIT, 'dbz')).toEqual([[5, 1, 2], [3, 4, 5], [1, 2, 3], [4, 5, 1]]);
    expect(days(lib, kept, FROM_EDIT, 'bob')).toEqual([[2], [3], [1], [2]]);
  });

  it('has each show go on from where it was with more airings of bob, in another block order', async () => {
    const { lib, old, next } = await setup(MORE_BOB);
    const kept = preservePositions(old, next, lib, EDIT);
    expect(days(lib, kept, FROM_EDIT, 'dbz')).toEqual([[5], [1], [2], [3]]);
    expect(days(lib, kept, FROM_EDIT, 'bob')).toEqual([[2, 3, 1], [2, 3, 1], [2, 3, 1], [2, 3, 1]]);
  });

  it('records the position at the edit date and leaves the days before it to the count', async () => {
    const { lib, old, next } = await setup(MORE_DBZ);
    const kept = preservePositions(old, next, lib, EDIT);
    expect(kept.positions).toEqual([
      { date: EDIT, show: 'bob', episode: '2' },
      { date: EDIT, show: 'dbz', episode: '5' },
    ]);
    expect(days(lib, kept, ['2003-03-03', '2003-03-04'], 'dbz')).toEqual(days(lib, next, ['2003-03-03', '2003-03-04'], 'dbz'));
  });

  it('respects an agenda pick of the old grade on the edit date', async () => {
    const picked = `${OLD}\nagenda:\n  ${EDIT}:\n    - bloco: "08:00"\n      item: 2\n      episodio: 3\n`;
    const { lib, old, next } = await setup(MORE_DBZ, { 'grades/antiga.yaml': picked });
    expect(days(lib, old, [EDIT], 'dbz')).toEqual([[3, 4]]);
    expect(days(lib, preservePositions(old, next, lib, EDIT), [EDIT, '2003-03-06'], 'dbz')).toEqual([[3, 4, 5], [1, 2, 3]]);
  });

  it('respects the saved position of the old grade, so editing twice keeps the place', async () => {
    const { lib, old, next } = await setup(MORE_DBZ);
    const first = preservePositions(old, next, lib, EDIT);
    const second = await setup(MORE_BOB);
    const again = preservePositions(first, second.next, second.lib, '2003-03-07');
    // The first edit puts dbz at 1 on Friday 03-07 (5,1,2 | 3,4,5 | 1...), and the second goes on from there.
    expect(days(lib, first, ['2003-03-07'], 'dbz')).toEqual([[1, 2, 3]]);
    expect(days(second.lib, again, ['2003-03-07', '2003-03-10'], 'dbz')).toEqual([[1], [2]]);
  });

  it('gives no position to a show that is only in the new grade or that draws its episodes', async () => {
    const withExtra = MORE_DBZ.replace('      - programa: bob', '      - programa: serie\n      - programa: sorte\n      - programa: bob');
    const old = OLD.replace('      - programa: dbz\n      - comerciais', '      - programa: sorte\n      - programa: dbz\n      - comerciais');
    const { lib, old: oldGrade, next } = await setup(withExtra, { 'grades/antiga.yaml': old });
    const kept = preservePositions(oldGrade, next, lib, EDIT);
    expect(kept.positions!.map((position) => position.show)).toEqual(['bob', 'dbz']);
  });

  it('counts a day off as the next airing day', async () => {
    const { lib, old, next } = await setup(MORE_DBZ);
    // 2003-03-08 is a Saturday: the old grade next airs on Monday 03-10, dbz at episode 1 and bob at 2.
    const kept = preservePositions(old, next, lib, '2003-03-08');
    expect(kept.positions).toEqual([
      { date: '2003-03-10', show: 'bob', episode: '2' },
      { date: '2003-03-10', show: 'dbz', episode: '1' },
    ]);
    expect(days(lib, kept, ['2003-03-10', '2003-03-11'], 'dbz')).toEqual([[1, 2, 3], [4, 5, 1]]);
  });

  it('writes the season when the episode number repeats', async () => {
    const olds = OLD.replace('      - programa: bob\n        episodios: 2', '      - programa: serie\n        episodios: 2');
    const news = MORE_DBZ.replace('      - programa: bob', '      - programa: serie');
    const { lib, old, next } = await setup(news, { 'grades/antiga.yaml': olds });
    // serie has 3 episodes: temporada-01/1, temporada-01/2 and temporada-02/1. It airs twice a day in the old grade.
    const at = (date: string) => preservePositions(old, next, lib, date).positions!.find((entry) => entry.show === 'serie')!;
    // 03-04 starts with the third one, 03-05 with the second (the number 2 is only in one season), 03-06 with the first.
    expect(at('2003-03-04').episode).toBe('temporada-02/1');
    expect(at(EDIT).episode).toBe('2');
    expect(at('2003-03-06').episode).toBe('temporada-01/1');
    expect(days(lib, preservePositions(old, next, lib, '2003-03-04'), ['2003-03-04'], 'serie')).toEqual([[3]]);
  });

  it('keeps the agenda and later positions, replaces the earlier ones of a recorded show', async () => {
    const extra = `\nagenda:\n  2003-03-04:\n    - bloco: "08:00"\n      item: 2\n      episodio: 3\nposicoes:\n  2003-03-04:\n    bob: 1\n    dbz: 3\n  ${EDIT}:\n    dbz: 1\n  2003-03-06:\n    dbz: 2\n`;
    const { lib, old, next } = await setup(MORE_DBZ + extra);
    expect(next.positions).toHaveLength(4);
    const kept = preservePositions(old, next, lib, EDIT);
    expect(kept.agenda).toEqual(next.agenda);
    // The two on 03-04 and the one on the edit date are replaced; the one on the 06th is a later decision and stays.
    expect(kept.positions).toEqual([
      { date: EDIT, show: 'bob', episode: '2' },
      { date: EDIT, show: 'dbz', episode: '5' },
      { date: '2003-03-06', show: 'dbz', episode: '2' },
    ]);
  });

  it('is deterministic and changes neither grade', async () => {
    const { lib, old, next } = await setup(MORE_DBZ);
    const before = JSON.stringify([old, next]);
    const one = preservePositions(old, next, lib, EDIT);
    const two = preservePositions(old, next, lib, EDIT);
    expect(two).toEqual(one);
    expect(JSON.stringify([old, next])).toBe(before);
    expect(one).not.toBe(next);
  });

  it('gives back an equal grade when nothing airs in both', async () => {
    const { lib, old, next } = await setup(`${header('Nova')}blocos:\n  - horario: "08:00"\n    itens:\n      - programa: serie\n`);
    expect(preservePositions(old, next, lib, EDIT)).toEqual(next);
  });
});

describe('saved positions and the agenda', () => {
  // MORE_DBZ: the 08:00 block is bob (item 1) and dbz three times (item 2).
  const pick = (date: string, episode: number) => `\nagenda:\n  ${date}:\n    - bloco: "08:00"\n      item: 2\n      episodio: ${episode}\n`;
  const kept = async (extra = '') => {
    const { lib, old, next } = await setup(MORE_DBZ + extra);
    return { lib, kept: preservePositions(old, next, lib, EDIT) };
  };

  it('has a hand pick win over the saved position of the same date', async () => {
    const { lib, kept: grade } = await kept(pick(EDIT, 2));
    expect(days(lib, grade, [EDIT, '2003-03-06'], 'dbz')).toEqual([[2, 3, 4], [5, 1, 2]]);
  });

  it('follows the pick that comes after the saved position', async () => {
    const { lib, kept: grade } = await kept(pick('2003-03-06', 1));
    expect(days(lib, grade, FROM_EDIT, 'dbz')).toEqual([[5, 1, 2], [1, 2, 3], [4, 5, 1], [2, 3, 4]]);
  });

  it('follows the saved position that comes after a pick', async () => {
    const { lib, kept: grade } = await kept(pick('2003-03-04', 3));
    expect(days(lib, grade, ['2003-03-04', EDIT, '2003-03-06'], 'dbz')).toEqual([[3, 4, 5], [5, 1, 2], [3, 4, 5]]);
  });

  it('goes on from a hand-written position, with nothing else in the grade', async () => {
    const { lib, next } = await setup(`${MORE_DBZ}\nposicoes:\n  2003-03-06:\n    dragon: 1\n    DBZ: 4\n`);
    expect(next.positions).toEqual([{ date: '2003-03-06', show: 'DBZ', episode: '4' }]);
    expect(days(lib, next, ['2003-03-06', '2003-03-07'], 'dbz')).toEqual([[4, 5, 1], [2, 3, 4]]);
  });

  it('keeps the days before any position as before', async () => {
    const { lib, next } = await setup(MORE_DBZ);
    const plain = await setup(`${MORE_DBZ}\nposicoes:\n  2003-03-07:\n    dbz: 2\n`);
    const early = ['2003-03-03', '2003-03-04', '2003-03-05', '2003-03-06'];
    expect(days(plain.lib, plain.next, early, 'dbz')).toEqual(days(lib, next, early, 'dbz'));
  });
});

describe('positions without any', () => {
  it('behaves as always for a grade without positions, and for an empty section', async () => {
    const plain = await setup(MORE_DBZ);
    const empty = await setup(`${MORE_DBZ}\nposicoes: {}\n`);
    expect(plain.messages).toEqual([]);
    expect(empty.messages).toEqual([]);
    expect(plain.next.positions).toBeUndefined();
    expect(empty.next.positions).toBeUndefined();
    const dates = ['2003-03-03', '2003-03-04', EDIT, '2003-03-08', '2003-03-10'];
    for (const date of dates) expect(planDay(empty.next, empty.lib, date)).toEqual(planDay(plain.next, plain.lib, date));
    expect(days(plain.lib, plain.next, dates, 'dbz')).toEqual([[1, 2, 3], [4, 5, 1], [2, 3, 4], [3, 4, 5], [1, 2, 3]]);
  });
});

describe('positions warnings', () => {
  const ignored = async (section: string) => {
    const result = await setup(`${MORE_DBZ}${section}`);
    const plain = await setup(MORE_DBZ);
    expect(result.next.positions).toBeUndefined();
    const dates = ['2003-03-03', '2003-03-05', '2003-03-10'];
    expect(days(result.lib, result.next, dates, 'dbz')).toEqual(days(plain.lib, plain.next, dates, 'dbz'));
    return result.messages;
  };

  it('warns about a bad date and about a day the grade does not air', async () => {
    expect(await ignored('posicoes:\n  "22/10/2026":\n    dbz: 3\n')).toEqual([expect.stringMatching(/22\/10\/2026: data inválida.*AAAA-MM-DD/)]);
    expect(await ignored('posicoes:\n  2003-02-30:\n    dbz: 3\n')).toEqual([expect.stringMatching(/2003-02-30: data inválida/)]);
    // 2003-03-08 is a Saturday.
    expect(await ignored('posicoes:\n  2003-03-08:\n    dbz: 3\n')).toEqual([expect.stringMatching(/2003-03-08.*sab.*não está em "dias"/)]);
  });

  it('warns about a show that is not in the blocks and about an episode that is not a number', async () => {
    expect(await ignored('posicoes:\n  2003-03-05:\n    serie: 1\n')).toEqual([expect.stringMatching(/o programa "serie" não está nos blocos/)]);
    expect(await ignored('posicoes:\n  2003-03-05:\n    dbz: banana\n')).toEqual([expect.stringMatching(/dbz: o episódio deve ser o número/)]);
  });

  it('warns about an episode the show does not have, or that is ambiguous', async () => {
    expect(await ignored('posicoes:\n  2003-03-05:\n    dbz: 99\n')).toEqual([expect.stringMatching(/Posições de 2003-03-05, dbz: o programa "dbz" não tem o episódio 99/)]);
    const seasons = MORE_DBZ.replace('      - programa: bob', '      - programa: serie');
    const result = await setup(`${seasons}posicoes:\n  2003-03-05:\n    serie: 1\n`);
    expect(result.next.positions).toBeUndefined();
    expect(result.messages).toEqual([expect.stringMatching(/mais de um episódio 1.*temporada-01\/1/)]);
    const fine = await setup(`${seasons}posicoes:\n  2003-03-05:\n    serie: temporada-02/1\n`);
    expect(fine.messages).toEqual([]);
    expect(days(fine.lib, fine.next, [EDIT], 'serie')).toEqual([[3]]);
  });

  it('warns about a section or entry in the wrong shape and keeps the valid entries', async () => {
    expect(await ignored('posicoes: 2003-03-05\n')).toEqual([expect.stringMatching(/"posicoes" deve ser uma lista de datas/)]);
    expect(await ignored('posicoes:\n  2003-03-05: 12\n')).toEqual([expect.stringMatching(/deve ser uma lista de programas/)]);

    const { lib, next, messages } = await setup(`${MORE_DBZ}posicoes:\n  2003-03-05:\n    bob: 3\n    dbz: 4\n    DBZ: 2\n    ghost: 1\n`);
    expect(messages).toHaveLength(2);
    expect(messages[0]).toMatch(/DBZ: esse programa já tem uma posição nessa data. Vale a primeira/);
    expect(messages[1]).toMatch(/"ghost" não está nos blocos/);
    expect(next.positions).toEqual([
      { date: EDIT, show: 'bob', episode: '3' },
      { date: EDIT, show: 'dbz', episode: '4' },
    ]);
    expect(days(lib, next, [EDIT], 'dbz')).toEqual([[4, 5, 1]]);
  });
});

describe('positions round trip', () => {
  const write = (schedule: Schedule) => scheduleToYaml({ schedule, estimates: schedule.blocks.map(() => 0), itemStarts: new Map() });
  const read = (text: string) => {
    const warnings: LibraryWarning[] = [];
    const schedule = parseSchedule('grades/nova.yaml', text, warnings);
    expect(warnings).toEqual([]);
    return schedule!;
  };

  it('reads, writes and reads again to the same grade', () => {
    const first = read(`${MORE_DBZ}
posicoes:
  2003-03-06:
    dbz: "012"
    bob: temporada-02/1
  2003-03-05:
    BOB: 4
`);
    expect(first.positions).toEqual([
      { date: '2003-03-05', show: 'BOB', episode: '4' },
      { date: '2003-03-06', show: 'bob', episode: 'temporada-02/1' },
      { date: '2003-03-06', show: 'dbz', episode: '12' },
    ]);
    const yaml = write(first);
    expect(yaml).toContain('posicoes:');
    expect(yaml).toContain('    dbz: 12\n');
    expect(yaml).toContain('    bob: "temporada-02/1"\n');
    expect(read(yaml)).toEqual(first);
    expect(write(read(yaml))).toBe(yaml);
  });

  it('writes the agenda and the positions together, and none for a grade without them', () => {
    const both = read(`${MORE_DBZ}\nagenda:\n  2003-03-04:\n    - bloco: "08:00"\n      item: 2\n      episodio: 3\nposicoes:\n  2003-03-05:\n    dbz: 5\n`);
    expect(read(write(both))).toEqual(both);
    expect(write(read(MORE_DBZ))).not.toContain('posicoes');
  });

  it('airs the same after a save, a rescan and the engine', async () => {
    const { lib, old, next } = await setup(MORE_DBZ);
    const kept = preservePositions(old, next, lib, EDIT);
    const rescanned = await scanLibrary(memorySource({ ...FILES, 'grades/antiga.yaml': OLD, 'grades/nova.yaml': write(kept) }));
    expect(rescanned.warnings).toEqual([]);
    const again = rescanned.schedules.find((schedule) => schedule.id === 'nova')!;
    expect(again.positions).toEqual(kept.positions);
    for (const date of FROM_EDIT) expect(planDay(again, rescanned, date)).toEqual(planDay({ ...kept, path: again.path }, lib, date));
  });
});

describe('saved positions and the nao-passar list', () => {
  const list = (episodes: string) => ({ 'nao-passar.yaml': `episodios:\n  dbz: [${episodes}]\n` });

  it('moves a blocked position on to the next allowed episode, where a hand pick airs as it is', async () => {
    const saved = await setup(`${MORE_DBZ}\nposicoes:\n  ${EDIT}:\n    dbz: 3\n`, list('3'));
    expect(saved.messages).toEqual([]);
    // Not a choice of the parent: 3 is blocked, so the day starts with 4 and goes on among the allowed ones (1, 2, 4, 5).
    expect(days(saved.lib, saved.next, [EDIT, '2003-03-06'], 'dbz')).toEqual([[4, 5, 1], [2, 4, 5]]);

    const pick = await setup(`${MORE_DBZ}\nagenda:\n  ${EDIT}:\n    - bloco: "08:00"\n      item: 2\n      episodio: 3\n`, list('3'));
    expect(days(pick.lib, pick.next, [EDIT], 'dbz')).toEqual([[3, 4, 5]]);
  });

  it('wraps a blocked position at the end of the show', async () => {
    const saved = await setup(`${MORE_DBZ}\nposicoes:\n  ${EDIT}:\n    dbz: 5\n`, list('5'));
    expect(days(saved.lib, saved.next, [EDIT], 'dbz')).toEqual([[1, 2, 3]]);
  });

  it('keeps each show where it was when only the list changes, with the old library given', async () => {
    const before = await setup(MORE_DBZ);
    const after = await setup(MORE_DBZ, list('2'));
    // The same grade airs dbz 2, 3, 4 on the edit date. Counting again with the list would jump over 3.
    expect(days(before.lib, before.next, [EDIT], 'dbz')).toEqual([[2, 3, 4]]);
    expect(days(after.lib, after.next, [EDIT], 'dbz')).toEqual([[4, 5, 1]]);
    const kept = preservePositions(before.next, after.next, after.lib, EDIT, before.lib);
    expect(kept.positions).toEqual([
      { date: EDIT, show: 'bob', episode: '3' },
      { date: EDIT, show: 'dbz', episode: '2' },
    ]);
    // 2 is blocked now, so the show starts with the next allowed one and goes on without a jump.
    expect(days(after.lib, kept, [EDIT, '2003-03-06'], 'dbz')).toEqual([[3, 4, 5], [1, 3, 4]]);
    expect(days(after.lib, kept, [EDIT], 'bob')).toEqual([[3]]);
  });
});
