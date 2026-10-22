import { describe, expect, it } from 'vitest';
import { createAutoSchedule, createShowChannels } from './auto';
import { blocklistToYaml, parseBlocklist } from './blocklist';
import { planDay, type DayPlan } from './engine';
import { scanLibrary } from './library';
import { memorySource } from './test-helpers';
import type { Library, LibraryWarning, Schedule } from './types';

// 2003-03-03 was a Monday. dbz airs twice a day (item 2 of 08:00 and item 1 of 10:00), bob twice in a row.
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
  'grades/teste.yaml': BLOCKS,
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

/** The library with a nao-passar.yaml (none when `list` is undefined) and, optionally, another grade. */
async function setup(list?: string, extra: Record<string, string> = {}) {
  const files = { ...FILES, ...extra, ...(list === undefined ? {} : { 'nao-passar.yaml': list }) };
  const lib = await scanLibrary(memorySource(files));
  return { lib, grade: lib.schedules[0]!, messages: lib.warnings.map((w) => w.message) };
}

const withBlocks = (replacement: string) => ({ 'grades/teste.yaml': BLOCKS.replace('- programa: dbz\n      - comerciais: 1\n      - programa: bob\n        episodios: 2', replacement) });

const episodes = (plan: DayPlan, show?: string) =>
  plan.blocks
    .flatMap((b) => b.items)
    .flatMap((item) => (item.kind === 'episode' && (!show || item.show.id === show) ? [item.episodeIndex + 1] : []));

const days = (lib: Library, grade: Schedule, dates: string[], show = 'dbz') => dates.map((date) => episodes(planDay(grade, lib, date), show));

const WEEK = ['2003-03-03', '2003-03-04', '2003-03-05', '2003-03-06', '2003-03-07', '2003-03-10'];

const others = (plan: DayPlan, show: string) => plan.blocks.flatMap((block) => block.items).filter((item) => item.kind !== 'episode' || item.show.id !== show);

describe('nao-passar: sequential shows', () => {
  it('changes nothing without the file, or with an empty one', async () => {
    const plain = await setup();
    expect(plain.messages).toEqual([]);
    expect(plain.lib.blocklist).toEqual({ shows: [], episodes: {} });
    expect(days(plain.lib, plain.grade, WEEK)).toEqual([[1, 2], [3, 4], [5, 1], [2, 3], [4, 5], [1, 2]]);
    for (const text of ['', 'programas: []\n', 'episodios: {}\n']) {
      const empty = await setup(text);
      expect(empty.messages).toEqual([]);
      expect(days(empty.lib, empty.grade, WEEK)).toEqual(days(plain.lib, plain.grade, WEEK));
    }
  });

  it('runs the sequence over the allowed episodes only, skipping the blocked ones', async () => {
    const { lib, grade, messages } = await setup('episodios:\n  dbz: [2, "004"]\n');
    expect(messages).toEqual([]);
    // 1, 3, 5 in turn, two a day, wrapping.
    expect(days(lib, grade, WEEK)).toEqual([[1, 3], [5, 1], [3, 5], [1, 3], [5, 1], [3, 5]]);
    // Other shows are untouched, and so is everything else in the day.
    const plain = await setup();
    expect(days(lib, grade, WEEK, 'bob')).toEqual(days(plain.lib, plain.grade, WEEK, 'bob'));
    expect(planDay(grade, lib, '2003-03-05').blocks.map((b) => b.items.length)).toEqual(planDay(plain.grade, plain.lib, '2003-03-05').blocks.map((b) => b.items.length));
  });

  it('gives the same plan on every run and for the day off that reruns the last one', async () => {
    const { lib, grade } = await setup('episodios:\n  dbz: [2]\n');
    expect(planDay(grade, lib, '2003-03-05')).toEqual(planDay(grade, lib, '2003-03-05'));
    expect(episodes(planDay(grade, lib, '2003-03-08'), 'dbz')).toEqual(episodes(planDay(grade, lib, '2003-03-07'), 'dbz'));
  });

  it('accepts a single episode written without a list, and any case in the show name', async () => {
    const { lib, grade, messages } = await setup('episodios:\n  DBZ: 5\n');
    expect(messages).toEqual([]);
    expect(days(lib, grade, WEEK.slice(0, 3))).toEqual([[1, 2], [3, 4], [1, 2]]);
  });

  it('blocks one season of a show with repeating numbers and tells the ambiguous ones apart', async () => {
    const serie = withBlocks('- programa: serie\n      - comerciais: 1');
    const { lib, grade, messages } = await setup('episodios:\n  serie: ["temporada-02/1"]\n', serie);
    expect(messages).toEqual([]);
    // Without the season-2 episode there are only the two of season 1.
    expect(days(lib, grade, WEEK.slice(0, 3), 'serie')).toEqual([[1], [2], [1]]);

    // A bare "1" is both episodes 1: both are blocked, and the file says so.
    const both = await setup('episodios:\n  serie: [1]\n', serie);
    expect(both.messages).toEqual([expect.stringMatching(/serie.*mais de um episódio 1.*todos ficaram de fora.*temporada-01\/1/)]);
    expect(days(both.lib, both.grade, WEEK.slice(0, 3), 'serie')).toEqual([[2], [2], [2]]);
  });
});

describe('nao-passar: the agenda wins', () => {
  const agenda = (date: string, episode: number) => `\nagenda:\n  ${date}:\n    - bloco: "08:00"\n      item: 2\n      episodio: ${episode}\n`;

  it('airs a picked episode that is blocked and continues with the allowed ones after it', async () => {
    const { lib, grade, messages } = await setup('episodios:\n  dbz: [2]\n', { 'grades/teste.yaml': BLOCKS + agenda('2003-03-05', 2) });
    expect(messages).toEqual([]);
    // Before the pick: 1 3 | 4 5. The pick day airs 2 and goes on with 3. Then 4 5 | 1 3 | 4 5.
    expect(days(lib, grade, WEEK)).toEqual([[1, 3], [4, 5], [2, 3], [4, 5], [1, 3], [4, 5]]);
  });

  it('skips the blocked episodes that follow a picked one', async () => {
    const { lib, grade } = await setup('episodios:\n  dbz: [5]\n', { 'grades/teste.yaml': BLOCKS + agenda('2003-03-04', 4) });
    // Before: 1 2. The pick day airs 4, then wraps past the blocked 5 to 1; then 2 3 | 4 1.
    expect(days(lib, grade, WEEK.slice(0, 4))).toEqual([[1, 2], [4, 1], [2, 3], [4, 1]]);
  });

  it('airs a pick of a show that is blocked as a whole, and nothing else of it', async () => {
    const { lib, grade } = await setup('programas: [bob]\n', { 'grades/teste.yaml': BLOCKS + agenda('2003-03-05', 2).replace('item: 2', 'item: 4') });
    // bob has 2 airings a day: the pick pins the first one; the second has nothing left to air.
    expect(days(lib, grade, WEEK.slice(0, 4), 'bob')).toEqual([[], [], [2], []]);
  });
});

describe('nao-passar: shows with ordem: aleatoria', () => {
  const random = withBlocks('- programa: sorte\n        episodios: 2\n      - comerciais: 1');
  const MANY = Array.from({ length: 30 }, (_, i) => `2003-04-${String(i + 1).padStart(2, '0')}`).filter((date) => !['06', '12', '13', '19', '20', '26', '27'].includes(date.slice(-2)));

  it('never draws a blocked episode, and leaves the other draws of the day as they were', async () => {
    const plain = await setup(undefined, random);
    const blocked = await setup('episodios:\n  sorte: [2, 3]\n', random);
    expect(blocked.messages).toEqual([]);
    const drawn = new Set<number>();
    for (const date of MANY) {
      const plan = planDay(blocked.grade, blocked.lib, date);
      for (const episode of episodes(plan, 'sorte')) drawn.add(episode);
      expect(episodes(plan, 'sorte')).toHaveLength(2);
      // The draw is always taken, so the bumper, the commercials and the other shows stay put.
      expect(others(plan, 'sorte')).toEqual(others(planDay(plain.grade, plain.lib, date), 'sorte'));
    }
    expect([...drawn].sort()).toEqual([1, 4]);
  });

  it('draws every episode when nothing blocks them', async () => {
    const plain = await setup(undefined, random);
    const drawn = new Set(MANY.flatMap((date) => episodes(planDay(plain.grade, plain.lib, date), 'sorte')));
    expect([...drawn].sort()).toEqual([1, 2, 3, 4]);
  });

  it('airs a blocked episode picked in the agenda, and goes back to drawing after it', async () => {
    const agenda = '\nagenda:\n  2003-03-04:\n    - bloco: "08:00"\n      item: 2\n      episodio: 3\n';
    const plain = await setup(undefined, random);
    const { lib, grade, messages } = await setup('episodios:\n  sorte: [2, 3]\n', { 'grades/teste.yaml': random['grades/teste.yaml'] + agenda });
    expect(messages).toEqual([]);
    const plan = planDay(grade, lib, '2003-03-04');
    // Both airings of the item follow the pick: 3, then the allowed episode after it.
    expect(episodes(plan, 'sorte')).toEqual([3, 4]);
    expect(others(plan, 'sorte')).toEqual(others(planDay(plain.grade, plain.lib, '2003-03-04'), 'sorte'));
    expect(episodes(planDay(grade, lib, '2003-03-05'), 'sorte').every((episode) => episode === 1 || episode === 4)).toBe(true);
  });
});

describe('nao-passar: a whole show', () => {
  const skipped = (plan: DayPlan) => plan.blocks.flatMap((block) => block.items).filter((item) => item.kind === 'episode').length;

  it('skips the item of a blocked show with a warning, and nothing else changes', async () => {
    const plain = await setup();
    const { lib, grade, messages } = await setup('programas: [bob]\n');
    expect(messages).toEqual([expect.stringMatching(/A grade usa o programa "bob", que está inteiro em nao-passar.yaml.*Ele será pulado/)]);
    expect(lib.warnings[0]!.path).toBe('grades/teste.yaml');
    expect(days(lib, grade, WEEK, 'bob')).toEqual(WEEK.map(() => []));
    // dbz goes on exactly as before, and the day still has its bumper and commercial.
    expect(days(lib, grade, WEEK)).toEqual(days(plain.lib, plain.grade, WEEK));
    const plan = planDay(grade, lib, '2003-03-05');
    expect(skipped(plan)).toBe(2);
    expect(plan.blocks[0]!.items.map((item) => item.kind)).toEqual(['interstitial', 'episode', 'interstitial']);
  });

  it('does the same when every episode of the show is on the list', async () => {
    const { lib, grade, messages } = await setup('episodios:\n  bob: [1, 2, 3]\n');
    expect(messages).toEqual([expect.stringMatching(/A grade usa o programa "bob", que está inteiro em nao-passar.yaml/)]);
    expect(days(lib, grade, WEEK, 'bob')).toEqual(WEEK.map(() => []));
  });

  it('skips a blocked random show too', async () => {
    const random = withBlocks('- programa: sorte\n        episodios: 2\n      - comerciais: 1');
    const { lib, grade } = await setup('programas: [sorte]\n', random);
    expect(days(lib, grade, WEEK, 'sorte')).toEqual(WEEK.map(() => []));
  });

  it('takes the show out of the automatic channel and of the per-show channels', async () => {
    const { lib } = await setup('programas: [bob, serie, sorte]\nepisodios:\n  dbz: [1, 2]\n');
    const auto = createAutoSchedule(lib)!;
    const shows = auto.blocks.flatMap((block) => block.items).flatMap((item) => (item.type === 'show' ? [item.show] : []));
    expect(shows).toEqual(['dbz']);
    // Whatever the channel airs is allowed.
    for (const date of WEEK) expect(episodes(planDay(auto, lib, date)).every((episode) => episode >= 3)).toBe(true);

    const channels = createShowChannels(lib);
    expect(channels.map((channel) => channel.id)).toEqual(['__programa:dbz']);
    // The loop holds each allowed episode once, not a repeat of the blocked slots.
    expect(episodes(planDay(channels[0]!, lib, '2003-03-05')).sort()).toEqual([3, 4, 5]);
  });

  it('has no automatic channel when everything is blocked', async () => {
    const { lib } = await setup('programas: [bob, serie, sorte, dbz]\n');
    expect(createAutoSchedule(lib)).toBeNull();
    expect(createShowChannels(lib)).toEqual([]);
  });

  it('skips blocked episodes in a per-show channel', async () => {
    const { lib } = await setup('episodios:\n  bob: [2]\n');
    const [bob] = createShowChannels(lib).filter((channel) => channel.id === '__programa:bob');
    expect(episodes(planDay(bob!, lib, '2003-03-05')).sort()).toEqual([1, 3]);
  });
});

describe('nao-passar: the file', () => {
  it('is read from the root of the library, also inside biblioteca/, with .yml too', async () => {
    const files = Object.fromEntries(Object.entries(FILES).map(([path, text]) => [`biblioteca/${path}`, text]));
    const lib = await scanLibrary(memorySource({ ...files, 'biblioteca/nao-passar.yml': 'episodios:\n  dbz: [2, 4]\n' }));
    expect(lib.root).toBe('biblioteca/');
    expect(lib.warnings).toEqual([]);
    expect(lib.blocklist).toEqual({ shows: [], episodes: { dbz: ['2', '4'] } });
    expect(days(lib, lib.schedules[0]!, WEEK.slice(0, 2))).toEqual([[1, 3], [5, 1]]);
  });

  it('warns about entries that are not in the library and ignores them', async () => {
    const plain = await setup();
    const { lib, grade, messages } = await setup('programas: [fantasma]\nepisodios:\n  dbz: [99, "temporada-01/2"]\n  nada: [1]\n');
    expect(messages).toEqual([
      expect.stringMatching(/"programas": o programa "fantasma" não existe/),
      expect.stringMatching(/o programa "dbz" não tem o episódio 99/),
      expect.stringMatching(/o programa "dbz" não tem o episódio temporada-01\/2/),
      expect.stringMatching(/"episodios": o programa "nada" não existe/),
    ]);
    expect(lib.warnings.every((warning) => warning.path === 'nao-passar.yaml')).toBe(true);
    expect(days(lib, grade, WEEK)).toEqual(days(plain.lib, plain.grade, WEEK));
  });

  it('ignores a file with a syntax error or the wrong shape, with a warning and no crash', async () => {
    const plain = await setup();
    for (const [text, message] of [
      ['programas: [dbz\n', /Erro de sintaxe/],
      ['- dbz\n- bob\n', /não está no formato esperado/],
      ['dbz\n', /não está no formato esperado/],
    ] as const) {
      const { lib, grade, messages } = await setup(text);
      expect(messages).toEqual([expect.stringMatching(message)]);
      expect(days(lib, grade, WEEK)).toEqual(days(plain.lib, plain.grade, WEEK));
    }
  });

  it('keeps the valid entries around a bad one, and warns about unknown keys', async () => {
    const { lib, grade, messages } = await setup('programa: [bob]\nprogramas: [{a: 1}, bob]\nepisodios:\n  dbz: [2, banana, 4]\n');
    expect(messages).toEqual([
      expect.stringMatching(/A chave "programa" não é conhecida/),
      expect.stringMatching(/"programas" deve ser uma lista de nomes de pasta.*\{"a":1\}/),
      expect.stringMatching(/dbz: "banana" não é um episódio/),
      expect.stringMatching(/A grade usa o programa "bob"/),
    ]);
    expect(lib.blocklist).toEqual({ shows: ['bob'], episodes: { dbz: ['2', '4'] } });
    expect(days(lib, grade, WEEK.slice(0, 2))).toEqual([[1, 3], [5, 1]]);

    const shape = await setup('programas: [bob]\nepisodios: [1, 2]\n');
    expect(shape.messages).toContainEqual(expect.stringMatching(/"episodios" deve ligar o nome da pasta/));
    expect(shape.lib.blocklist.shows).toEqual(['bob']);
  });
});

describe('nao-passar round trip', () => {
  const read = (text: string) => {
    const warnings: LibraryWarning[] = [];
    const list = parseBlocklist('nao-passar.yaml', text, warnings);
    expect(warnings).toEqual([]);
    return list;
  };

  it('reads, writes and reads again to the same list, in a hand-writable file', () => {
    const first = read(`
programas:
  - dragon-ball-z
  - Bob-Esponja
  - dragon-ball-z
episodios:
  pica-pau: [3, "temporada-02/12", "03", 1]
  serie: 7
  Pica-Pau: 20
`);
    expect(first).toEqual({
      shows: ['Bob-Esponja', 'dragon-ball-z'],
      episodes: { 'pica-pau': ['1', '3', '20', 'temporada-02/12'], serie: ['7'] },
    });
    const yaml = blocklistToYaml(first);
    expect(yaml).toBe('programas: [Bob-Esponja, dragon-ball-z]\n\nepisodios:\n  pica-pau: [1, 3, 20, "temporada-02/12"]\n  serie: [7]\n');
    expect(read(yaml)).toEqual(first);
    expect(blocklistToYaml(read(yaml))).toBe(yaml);
  });

  it('quotes names that YAML would read as something else, and keeps a header', () => {
    const list = { shows: ['yes', '123', 'null', 'a b'], episodes: { no: ['1'] } };
    const yaml = blocklistToYaml(list, ['Feito pelo app']);
    expect(yaml.startsWith('# Feito pelo app\n\nprogramas: [')).toBe(true);
    expect(read(yaml)).toEqual({ shows: ['123', 'a b', 'null', 'yes'], episodes: { no: ['1'] } });
  });

  it('writes an empty list as a file that reads back empty', () => {
    expect(blocklistToYaml({ shows: [], episodes: {} })).toBe('programas: []\n');
    expect(read('programas: []\n')).toEqual({ shows: [], episodes: {} });
  });
});
