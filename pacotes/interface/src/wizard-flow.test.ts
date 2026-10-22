import { generateSchedule, planDay, preservePositions, scanLibrary, type Library, type LibrarySource, type Schedule } from '@tv-gominho/nucleo';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  adSummary,
  advancedLines,
  summaryLines,
  buildChannel,
  bumperBrands,
  bumperChoice,
  bumperEras,
  chooseBrand,
  chooseNew,
  chooseReplace,
  dayLabel,
  firstProblemStep,
  gradeFolderFiles,
  initialState,
  longDayLabel,
  planReplace,
  previewDates,
  replaceableChannels,
  stepAd,
  stepEra,
  stepProblem,
  toAdBreaks,
  toGenerateOptions,
  type WizardState,
} from './wizard-model';

// The newer steps of the wizard (commercials, bumpers, preview, replacing a channel) and the channel they build.

function source(files: Record<string, string>): LibrarySource {
  return {
    files: Object.keys(files),
    async readText(path) {
      const text = files[path];
      if (text === undefined) throw new Error(`No such file: ${path}`);
      return text;
    },
  };
}

const OLD_GRADE = `
nome: Manhã antiga
data_inicio: 2026-10-01
dias: [seg, ter, qua, qui, sex]
blocos:
  - horario: "08:00"
    itens:
      - programa: dbz
        episodios: 2
`;

const FILES: Record<string, string> = {
  'programas/dbz/programa.yaml': 'titulo: DBZ',
  ...Object.fromEntries(Array.from({ length: 9 }, (_, i) => [`programas/dbz/episodios/00${i + 1}.mp4`, ''])),
  'programas/pinguins/programa.yaml': 'titulo: Pinguins',
  ...Object.fromEntries(Array.from({ length: 4 }, (_, i) => [`programas/pinguins/episodios/00${i + 1}.mp4`, ''])),
  'vinhetas/aberturas/tv-globinho/Abertura (2003-2009).mp4': '',
  'vinhetas/aberturas/tv-globinho/Abertura (2009-2014).mp4': '',
  'vinhetas/aberturas/cartoon-network/abertura.mp4': '',
  'vinhetas/encerramentos/tv-globinho/Encerramento (2011).mp4': '',
  'vinhetas/chamadas/tv-globinho/chamada.mp4': '',
  'vinhetas/intervalos/tv-globinho/volta-ja.mp4': '',
  'vinhetas/intervalos/tv-globinho-2003-2009/entrada.mp4': '',
  'vinhetas/intervalos/tv-globinho-2003-2009/saida.mp4': '',
  'vinhetas/intervalos/cartoon-network/entrada.mp4': '',
  'vinhetas/comerciais/a.mp4': '',
  'vinhetas/comerciais/b.mp4': '',
  'vinhetas/comerciais/c.mp4': '',
  'grades/manha.yaml': OLD_GRADE,
  'grades/manha.2026-10-01.yaml.bak': 'nome: velho',
};

const durationOf = (path: string) => (path.includes('/episodios/') ? 21 * 60 : path.includes('comerciais/') ? 30 : 10);
const TODAY = '2026-10-22'; // a Thursday

let library: Library;
beforeAll(async () => {
  library = await scanLibrary(source(FILES));
});

const ready = (patch: Partial<WizardState> = {}): WizardState => ({ ...initialState(), name: 'Manhã nova', ...patch });
const build = (state: WizardState, taken: readonly string[] = ['grades/manha.yaml']) =>
  buildChannel({ state, library, durationOf, settings: library.settings, today: TODAY, taken });

describe('commercials step', () => {
  it('follows the general settings by default: the grade gets no rules', () => {
    expect(toAdBreaks(initialState())).toBeUndefined();
    expect(toGenerateOptions(ready(), TODAY).adBreaks).toBeUndefined();
  });

  it('writes all four rules when the channel has its own', () => {
    const state = ready({ adMode: 'custom', ad: { every: 6, ads: 2, afterEpisode: false, bumpers: true } });
    expect(toAdBreaks(state)).toEqual({ every: 6, ads: 2, afterEpisode: false, bumpers: true });
    expect(toGenerateOptions(state, TODAY).adBreaks).toEqual({ every: 6, ads: 2, afterEpisode: false, bumpers: true });
    expect(build(state).generated.schedule.adBreaks).toEqual({ every: 6, ads: 2, afterEpisode: false, bumpers: true });
  });

  it('starts the channel rules from the general settings of the app', () => {
    expect(initialState({ every: 12, ads: 4, afterEpisode: false, bumpers: false }).ad).toEqual({ every: 12, ads: 4, afterEpisode: false, bumpers: false });
    expect(initialState().ad).toEqual({ every: 8, ads: 3, afterEpisode: true, bumpers: true });
  });

  it('moves the minutes and the number of ads within the limits of the settings', () => {
    const ad = { every: 8, ads: 3, afterEpisode: true, bumpers: true };
    expect(stepAd(ad, 'every', 1).every).toBe(9);
    expect(stepAd({ ...ad, every: 0 }, 'every', -1).every).toBe(0);
    expect(stepAd({ ...ad, every: 30 }, 'every', 1).every).toBe(30);
    expect(stepAd({ ...ad, ads: 1 }, 'ads', -1).ads).toBe(1);
    expect(stepAd({ ...ad, ads: 10 }, 'ads', 1).ads).toBe(10);
    expect(stepAd(ad, 'ads', -1)).toEqual({ ...ad, ads: 2 });
  });

  it('describes the rules in words', () => {
    expect(adSummary({ every: 8, ads: 3, afterEpisode: true, bumpers: true })).toBe(
      'intervalo a cada 8 min de episódio, 3 comerciais por intervalo, intervalo depois de cada episódio, com vinhetas de entrada e saída',
    );
    expect(adSummary({ every: 0, ads: 1, afterEpisode: false, bumpers: false })).toBe(
      'sem intervalos no meio do episódio, 1 comercial por intervalo, sem intervalo depois do episódio, sem vinhetas de entrada e saída',
    );
  });

  it('estimates the blocks with the channel rules: fewer breaks, more shows', () => {
    const count = (state: WizardState) => build(state).generated.schedule.blocks[0]!.items.filter((item) => item.type === 'show').length;
    const light = ready({ adMode: 'custom', ad: { every: 0, ads: 1, afterEpisode: false, bumpers: false } });
    const heavy = ready({ adMode: 'custom', ad: { every: 4, ads: 8, afterEpisode: true, bumpers: true } });
    expect(count(light)).toBeGreaterThan(count(heavy));
  });
});

describe('bumpers step', () => {
  it('lists the brands found in the bumper folders, without the years of the era', () => {
    expect(bumperBrands(library)).toEqual([
      { id: 'cartoon-network', count: 2 },
      { id: 'tv-globinho', count: 7 },
    ]);
  });

  it('lists the years in the names, for any brand or for one', () => {
    expect(bumperEras(library, '')).toEqual([2003, 2009, 2011, 2014]);
    expect(bumperEras(library, 'tv-globinho')).toEqual([2003, 2009, 2011, 2014]);
    expect(bumperEras(library, 'cartoon-network')).toEqual([]);
  });

  it('keeps the era only when the new brand has it', () => {
    const state = ready({ brand: 'tv-globinho', era: 2009 });
    expect(chooseBrand(state, library, 'tv-globinho').era).toBe(2009);
    expect(chooseBrand(state, library, 'cartoon-network')).toMatchObject({ brand: 'cartoon-network', era: null });
    expect(chooseBrand(state, library, '')).toMatchObject({ brand: '', era: 2009 });
  });

  it('steps through "any era" and the years found, around', () => {
    const eras = [2003, 2009];
    expect(stepEra(eras, null, 1)).toBe(2003);
    expect(stepEra(eras, 2003, 1)).toBe(2009);
    expect(stepEra(eras, 2009, 1)).toBeNull();
    expect(stepEra(eras, null, -1)).toBe(2009);
    expect(stepEra([], null, 1)).toBeNull();
  });

  it('hands the brand and era to the generator, "any" being an empty brand', () => {
    expect(toGenerateOptions(ready(), TODAY)).toMatchObject({ brand: '', era: undefined });
    expect(toGenerateOptions(ready({ brand: 'tv-globinho', era: 2011 }), TODAY)).toMatchObject({ brand: 'tv-globinho', era: 2011 });
  });

  it('picks the same bumpers as the generator, and as `tv-gominho grade`', () => {
    const state = ready({ brand: 'tv-globinho', era: 2011 });
    const choice = bumperChoice(library, state);
    const schedule = build(state).generated.schedule;
    const items = schedule.blocks[0]!.items;
    expect(choice[0]).toEqual({ label: 'Abertura', ref: 'aberturas/tv-globinho/Abertura (2009-2014).mp4' });
    expect(items[0]).toEqual({ type: 'interstitial', ref: choice[0]!.ref });
    expect(items.at(-1)).toEqual({ type: 'interstitial', ref: choice[1]!.ref });
    expect(schedule.breakBumpersRef).toBe(choice[2]!.ref);
  });

  it('gives no bumpers for a library that has none', async () => {
    const bare = await scanLibrary(source({ 'programas/dbz/programa.yaml': '', 'programas/dbz/episodios/001.mp4': '' }));
    expect(bumperBrands(bare)).toEqual([]);
    expect(bumperEras(bare, '')).toEqual([]);
    expect(bumperChoice(bare, ready()).map((entry) => entry.ref)).toEqual([null, null, null]);
  });
});

describe('new channel or replace', () => {
  it('is a new channel by default, and the confirmation is not asked', () => {
    const state = ready();
    expect(state.target).toBeNull();
    expect(stepProblem('save', state, 5)).toBeNull();
  });

  it('offers only the grade files of the library to replace', () => {
    expect(replaceableChannels(library).map((channel) => channel.id)).toEqual(['manha']);
  });

  it('asks for an explicit confirmation before replacing', () => {
    const old = library.schedules[0]!;
    const chosen = chooseReplace(initialState(), old);
    expect(chosen).toMatchObject({ target: 'manha', name: 'Manhã antiga', confirmed: false });
    expect(stepProblem('save', chosen, 5)).toMatch(/confirmação/);
    expect(firstProblemStep(chosen, 5)).toBe('save');
    expect(stepProblem('save', { ...chosen, confirmed: true }, 5)).toBeNull();
    expect(chooseNew({ ...chosen, confirmed: true })).toMatchObject({ target: null, confirmed: false });
  });

  it('plans the backup next to the channel, with the date, never in the name of a channel', () => {
    const old = library.schedules[0]!;
    const plan = planReplace(old, TODAY, gradeFolderFiles(Object.keys(FILES), ''), '');
    expect(plan).toEqual({
      fileName: 'manha',
      path: 'grades/manha.yaml',
      backupName: 'manha.2026-10-22.yaml.bak',
      backupPath: 'grades/manha.2026-10-22.yaml.bak',
    });
    // The same day twice: another name, the first copy stays.
    const again = planReplace(old, TODAY, ['manha.yaml', 'manha.2026-10-22.yaml.bak'], '');
    expect(again.backupName).toBe('manha.2026-10-22-2.yaml.bak');
    expect(planReplace({ ...old, path: 'biblioteca/grades/manha.yml' }, TODAY, [], 'biblioteca/').backupPath).toBe('biblioteca/grades/manha.2026-10-22.yaml.bak');
  });

  it('lists the files of grades/, backups included, to avoid their names', () => {
    expect(gradeFolderFiles(Object.keys(FILES), '')).toEqual(['manha.yaml', 'manha.2026-10-01.yaml.bak']);
    expect(gradeFolderFiles(['biblioteca/grades/a.yaml', 'grades/b.yaml', 'biblioteca/grades/sub/c.yaml'], 'biblioteca/')).toEqual(['a.yaml']);
  });

  it('builds a new channel under a free file name, with the file name as its id', () => {
    const built = build(ready({ name: 'Manhã' }));
    expect(built.replaces).toBeNull();
    expect(built.fileName).toBe('manha-2');
    expect(built.generated.schedule).toMatchObject({ id: 'manha-2', path: 'grades/manha-2.yaml', name: 'Manhã', startDate: TODAY });
    expect(built.generated.schedule.positions).toBeUndefined();
  });

  it('builds the replacement over the same file and id, with the positions of the old channel on today', () => {
    const old = library.schedules[0]!;
    const state = { ...chooseReplace(ready(), old), confirmed: true, name: 'Manhã nova' };
    const built = build(state);
    expect(built.replaces).toBe(old);
    expect(built.fileName).toBe('manha');
    expect(built.generated.schedule).toMatchObject({ id: 'manha', path: 'grades/manha.yaml', name: 'Manhã nova' });

    // Exactly preservePositions(old, new, library, today) on the channel the generator makes.
    const fresh = generateSchedule(library, durationOf, toGenerateOptions(state, TODAY, library.settings)).schedule;
    const expected = preservePositions(old, { ...fresh, id: 'manha', path: 'grades/manha.yaml' }, library, TODAY);
    expect(built.generated.schedule).toEqual(expected);
    expect(built.generated.schedule.positions?.length).toBeGreaterThan(0);
    expect(built.generated.schedule.positions!.every((position) => position.date === TODAY)).toBe(true);
  });

  it('keeps every show where it was: the first episode of today is the one the old channel airs', () => {
    const old: Schedule = library.schedules[0]!;
    const built = build({ ...chooseReplace(ready(), old), confirmed: true });
    const firstOf = (schedule: Schedule, show: string) =>
      planDay(schedule, library, TODAY).blocks.flatMap((block) => block.items).find((item) => item.kind === 'episode' && item.show.id === show);
    const before = firstOf(old, 'dbz');
    const after = firstOf(built.generated.schedule, 'dbz');
    expect(before).toBeDefined();
    expect(after).toMatchObject({ episodeIndex: (before as { episodeIndex: number }).episodeIndex });
    // The days that follow go on from there, one episode per airing.
    const tomorrow = planDay(built.generated.schedule, library, '2026-10-23').blocks.flatMap((block) => block.items).find((item) => item.kind === 'episode' && item.show.id === 'dbz');
    expect(tomorrow).toBeDefined();
  });

  it('refuses to replace a channel that is no longer in the library', () => {
    expect(() => build({ ...ready(), target: 'sumiu', confirmed: true })).toThrow(/não está mais/);
  });
});

describe('preview days', () => {
  it('lists seven days from today, across the end of the month', () => {
    expect(previewDates('2026-10-29')).toEqual(['2026-10-29', '2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02', '2026-11-03', '2026-11-04']);
    expect(previewDates('2026-10-22', 2)).toEqual(['2026-10-22', '2026-10-23']);
  });

  it('names a day with the weekday and the date', () => {
    expect(dayLabel('2026-10-22')).toBe('Qui 22/10');
    expect(longDayLabel('2026-10-24')).toBe('Sábado, 24/10');
  });
});

describe('summary and advanced lines', () => {
  const context = (fileName = 'manha-nova') => ({ library, fileName });

  it('lists every answer with the screen that changes it', () => {
    const lines = summaryLines(ready(), context());
    expect(lines.map((line) => [line.id, line.step])).toEqual([
      ['name', 'review'],
      ['ranges', 'when'],
      ['days', 'when'],
      ['shows', 'shows'],
      ['commercials', 'commercials'],
      ['bumpers', 'bumpers'],
      ['file', 'replace'],
    ]);
    const value = (id: string) => lines.find((line) => line.id === id)!.value;
    expect(value('name')).toBe('Manhã nova');
    expect(value('ranges')).toBe('08:00–12:00');
    expect(value('days')).toBe('Segunda a sexta');
    expect(value('shows')).toBe('Todos os programas');
    expect(value('commercials')).toBe('Seguir a configuração geral');
    expect(value('bumpers')).toMatch(/^Qualquer marca, qualquer época/);
    expect(value('file')).toBe('grades/manha-nova.yaml · Canal novo');
  });

  it('shows the picked shows in order, the own rules, and the channel to replace', () => {
    const old = library.schedules[0]!;
    const state = { ...chooseReplace(ready({ showMode: 'pick', picked: ['pinguins', 'dbz'], adMode: 'custom' }), old), brand: 'tv-globinho', era: 2011 };
    const lines = summaryLines(state, context('manha'));
    const value = (id: string) => lines.find((line) => line.id === id)!.value;
    expect(value('shows')).toBe('Pinguins → DBZ');
    expect(value('commercials')).toMatch(/^Regras próprias: /);
    expect(value('bumpers')).toMatch(/^tv-globinho, 2011 · abertura /);
    expect(value('file')).toBe('grades/manha.yaml · Trocar o canal “Manhã antiga”');
  });

  it('starts the advanced list on the defaults: nothing marked as changed', () => {
    const lines = advancedLines(ready(), library);
    expect(lines.map((line) => line.id)).toEqual(['commercials', 'bumpers', 'replace']);
    expect(lines.map((line) => line.value)).toEqual(['Seguir a configuração geral', 'Qualquer marca, qualquer época', 'Não: criar um canal novo']);
    expect(lines.some((line) => line.changed)).toBe(false);
  });

  it('marks what was changed', () => {
    const lines = advancedLines({ ...chooseReplace(ready({ adMode: 'custom', brand: 'tv-globinho' }), library.schedules[0]!) }, library);
    expect(lines.map((line) => line.changed)).toEqual([true, true, true]);
    expect(lines[2]!.value).toBe('Trocar o canal “Manhã antiga”');
  });
});
