import { allowedEpisodes, emptyBlocklist, parseSchedule, scanLibrary, type Blocklist, type Library, type LibraryWarning } from '@tv-gominho/nucleo';
import { describe, expect, it } from 'vitest';
import {
  blocklistPath,
  blocklistText,
  buildSavePlan,
  canBlockEpisode,
  changedShows,
  copyBlocklist,
  episodeRef,
  isEpisodeBlocked,
  replacePositions,
  sameBlocklist,
  showStatus,
  summarize,
  toggleEpisode,
  toggleShow,
} from './blocklist-model';

const GRADE = `# Minha grade, com comentário.
nome: Manhã
data_inicio: 2003-03-03
dias: [seg, ter, qua, qui, sex]

blocos:
  - horario: "08:00"
    itens:
      - programa: dbz
`;

const OTHER = GRADE.replace('Manhã', 'Bob').replace('dbz', 'bob');

const FILES: Record<string, string> = {
  'programas/dbz/programa.yaml': 'titulo: DBZ',
  ...Object.fromEntries([1, 2, 3, 4, 5].map((n) => [`programas/dbz/episodios/00${n}.mp4`, ''])),
  'programas/bob/programa.yaml': 'titulo: Bob',
  ...Object.fromEntries([1, 2, 3].map((n) => [`programas/bob/episodios/00${n}.mp4`, ''])),
  'programas/serie/programa.yaml': 'titulo: Serie',
  'programas/serie/episodios/temporada-01/001.mp4': '',
  'programas/serie/episodios/temporada-01/002.mp4': '',
  'programas/serie/episodios/temporada-02/001.mp4': '',
  'programas/sem/episodios/intro.mp4': '',
  'grades/manha.yaml': GRADE,
  'grades/bob.yaml': OTHER,
};

async function setup(extra: Record<string, string> = {}): Promise<Library> {
  const files = { ...FILES, ...extra };
  return scanLibrary({
    files: Object.keys(files),
    async readText(path) {
      const text = files[path];
      if (text === undefined) throw new Error(path);
      return text;
    },
  });
}

const show = (library: Library, id: string) => library.shows.find((s) => s.id === id)!;
const blocked = (library: Library, list: Blocklist, id: string) => {
  const s = show(library, id);
  return s.episodes.flatMap((_, i) => (isEpisodeBlocked(library, list, s, i) ? [i + 1] : []));
};

describe('episodeRef', () => {
  it('names an episode by its number, with the season only when the number repeats', async () => {
    const library = await setup();
    expect(episodeRef(show(library, 'dbz'), 2)).toBe('3');
    const serie = show(library, 'serie');
    expect(serie.episodes.map((_, i) => episodeRef(serie, i))).toEqual(['temporada-01/1', '2', 'temporada-02/1']);
  });

  it('has no name for an episode without a number', async () => {
    const library = await setup();
    const sem = show(library, 'sem');
    expect(episodeRef(sem, 0)).toBeNull();
    expect(canBlockEpisode(sem, 0)).toBe(false);
  });
});

describe('toggling a show', () => {
  it('blocks the show whole, then releases it', async () => {
    const library = await setup();
    const dbz = show(library, 'dbz');
    const list = toggleShow(library, emptyBlocklist(), dbz);
    expect(list).toEqual({ shows: ['dbz'], episodes: {} });
    expect(showStatus(library, list, dbz)).toEqual({ state: 'all', blocked: 5, total: 5 });
    expect(toggleShow(library, list, dbz)).toEqual(emptyBlocklist());
  });

  it('turns a partly blocked show into a whole blocked one and drops its single episodes', async () => {
    const library = await setup();
    const dbz = show(library, 'dbz');
    const partly = toggleEpisode(library, emptyBlocklist(), dbz, 0);
    expect(showStatus(library, partly, dbz).state).toBe('some');
    expect(toggleShow(library, partly, dbz)).toEqual({ shows: ['dbz'], episodes: {} });
  });

  it('does not touch the entries of other shows', async () => {
    const library = await setup();
    const list: Blocklist = { shows: ['bob'], episodes: { dbz: ['1'] } };
    expect(toggleShow(library, list, show(library, 'dbz'))).toEqual({ shows: ['bob', 'dbz'], episodes: {} });
  });

  it('matches the folder name ignoring case', async () => {
    const library = await setup();
    const list: Blocklist = { shows: ['DBZ'], episodes: {} };
    expect(showStatus(library, list, show(library, 'dbz')).state).toBe('all');
    expect(toggleShow(library, list, show(library, 'dbz'))).toEqual(emptyBlocklist());
  });
});

describe('toggling an episode', () => {
  it('blocks and releases single episodes', async () => {
    const library = await setup();
    const dbz = show(library, 'dbz');
    let list = toggleEpisode(library, emptyBlocklist(), dbz, 1);
    list = toggleEpisode(library, list, dbz, 3);
    expect(list).toEqual({ shows: [], episodes: { dbz: ['2', '4'] } });
    expect(blocked(library, list, 'dbz')).toEqual([2, 4]);
    expect(showStatus(library, list, dbz)).toEqual({ state: 'some', blocked: 2, total: 5 });
    list = toggleEpisode(library, list, dbz, 1);
    expect(list).toEqual({ shows: [], episodes: { dbz: ['4'] } });
    expect(toggleEpisode(library, list, dbz, 3)).toEqual(emptyBlocklist());
  });

  it('opens a whole blocked show into its other episodes', async () => {
    const library = await setup();
    const dbz = show(library, 'dbz');
    const list = toggleEpisode(library, { shows: ['dbz'], episodes: {} }, dbz, 2);
    expect(list.shows).toEqual([]);
    expect(blocked(library, list, 'dbz')).toEqual([1, 2, 4, 5]);
  });

  it('writes the season when seasons repeat the number', async () => {
    const library = await setup();
    const serie = show(library, 'serie');
    const list = toggleEpisode(library, emptyBlocklist(), serie, 2);
    expect(list.episodes).toEqual({ serie: ['temporada-02/1'] });
    expect(blocked(library, list, 'serie')).toEqual([3]);
  });

  it('leaves the list alone for an episode it cannot name', async () => {
    const library = await setup();
    const list = emptyBlocklist();
    expect(toggleEpisode(library, list, show(library, 'sem'), 0)).toBe(list);
  });

  it('does not change the list it was given', async () => {
    const library = await setup();
    const list: Blocklist = { shows: [], episodes: { dbz: ['1'] } };
    const copy = copyBlocklist(list);
    toggleEpisode(library, list, show(library, 'dbz'), 4);
    expect(list).toEqual(copy);
  });
});

describe('list as a whole', () => {
  it('compares lists by the file they would become', () => {
    expect(sameBlocklist({ shows: ['b', 'a'], episodes: {} }, { shows: ['a', 'b'], episodes: {} })).toBe(true);
    expect(sameBlocklist({ shows: ['a'], episodes: {} }, emptyBlocklist())).toBe(false);
  });

  it('counts shows blocked whole and other blocked episodes', async () => {
    const library = await setup();
    const list: Blocklist = { shows: ['dbz'], episodes: { bob: ['1', '2'], serie: ['2'] } };
    expect(summarize(library, list)).toEqual({ shows: 1, episodes: 3 });
  });

  it('finds the shows whose blocked episodes changed', async () => {
    const library = await setup({ 'nao-passar.yaml': 'programas: [bob]\n' });
    expect(changedShows(library, library.blocklist)).toEqual(new Set());
    expect([...changedShows(library, { shows: ['bob'], episodes: { dbz: ['1'] } })]).toEqual(['dbz']);
  });

  it('finds nao-passar.yaml whatever its case, or puts it at the root', () => {
    expect(blocklistPath(['a/Nao-Passar.yaml', 'biblioteca/Nao-Passar.yaml'], 'biblioteca/')).toBe('biblioteca/Nao-Passar.yaml');
    expect(blocklistPath(['programas/x.mp4'], '')).toBe('nao-passar.yaml');
  });
});

describe('replacePositions', () => {
  const positions = [{ date: '2003-03-05', show: 'dbz', episode: '3' }];

  it('adds the section after the grade and keeps its comments', () => {
    const text = replacePositions(GRADE, positions);
    expect(text.startsWith('# Minha grade, com comentário.\n')).toBe(true);
    expect(text.endsWith('posicoes:\n  "2003-03-05":\n    dbz: 3\n')).toBe(true);
  });

  it('replaces the old section and keeps what follows it', () => {
    const before = `${GRADE}\nposicoes:\n  "2003-03-04":\n    dbz: 2\n\n# fim\nagenda: {}\n`;
    const text = replacePositions(before, positions);
    expect(text).not.toContain('2003-03-04');
    expect(text).toContain('dbz: 3');
    expect(text.endsWith('# fim\nagenda: {}\n')).toBe(true);
  });

  it('takes the section out when there are no positions', () => {
    expect(replacePositions(`${GRADE}\nposicoes:\n  "2003-03-04":\n    dbz: 2\n`, undefined)).toBe(GRADE);
  });
});

describe('buildSavePlan', () => {
  const texts = (library: Library) => new Map(library.schedules.map((schedule) => [schedule.path, FILES[schedule.path]!]));
  const positionsOf = (text: string) => parseSchedule('x.yaml', text, [] as LibraryWarning[])?.positions;

  it('saves the position of each show on the day, so blocking an episode does not make the show skip', async () => {
    const library = await setup();
    const dbz = show(library, 'dbz');
    // Without saving anything, blocking episode 1 makes the third day (03-05) go from episode 3 to 4.
    const list = toggleEpisode(library, emptyBlocklist(), dbz, 0);
    const plan = buildSavePlan(library, list, '2003-03-05', 'nao-passar.yaml', texts(library));
    expect(plan.problems).toEqual([]);
    expect(plan.grades.map((grade) => grade.path)).toEqual(['grades/manha.yaml']);
    const [grade] = plan.grades;
    expect(grade!.name).toBe('manha.yaml');
    expect(positionsOf(grade!.text)).toEqual([{ date: '2003-03-05', show: 'dbz', episode: '3' }]);
    expect(grade!.text.startsWith('# Minha grade, com comentário.')).toBe(true);
    expect(plan.list).toEqual({ path: 'nao-passar.yaml', name: 'nao-passar.yaml', text: blocklistText(list) });
  });

  it('leaves out grades without a show of the changed list', async () => {
    const library = await setup();
    const plan = buildSavePlan(library, { shows: ['serie'], episodes: {} }, '2003-03-05', 'nao-passar.yaml', texts(library));
    expect(plan.grades).toEqual([]);
  });

  it('keeps the old position in the file; the engine moves a blocked one on to the next allowed episode', async () => {
    const library = await setup();
    // On 03-05 dbz airs episode 3: that stays the position, and with 3 blocked the show goes on with 4.
    const list = toggleEpisode(library, emptyBlocklist(), show(library, 'dbz'), 2);
    const plan = buildSavePlan(library, list, '2003-03-05', 'nao-passar.yaml', texts(library));
    expect(positionsOf(plan.grades[0]!.text)).toEqual([{ date: '2003-03-05', show: 'dbz', episode: '3' }]);
    expect(allowedEpisodes({ ...library, blocklist: list }, show(library, 'dbz'))).toEqual([0, 1, 3, 4]);
  });

  it('reports a grade it cannot read, and writes nothing for it', async () => {
    const library = await setup();
    const list = toggleShow(library, emptyBlocklist(), show(library, 'dbz'));
    const plan = buildSavePlan(library, list, '2003-03-05', 'nao-passar.yaml', new Map());
    expect(plan.grades).toEqual([]);
    expect(plan.problems.map((problem) => problem.path)).toEqual(['grades/bob.yaml', 'grades/manha.yaml']);
  });

  it('has no grades to rewrite in a library without grades', async () => {
    const library = await setup();
    const bare = { ...library, schedules: [] };
    const plan = buildSavePlan(bare, toggleShow(bare, emptyBlocklist(), show(bare, 'dbz')), '2003-03-05', 'nao-passar.yaml', new Map());
    expect(plan.grades).toEqual([]);
    expect(plan.problems).toEqual([]);
  });
});
