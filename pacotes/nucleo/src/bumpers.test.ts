import { describe, expect, it } from 'vitest';
import { bumperRole, bumpersOf, groupBumpers } from './bumpers';
import { createAutoSchedule } from './auto';
import { buildTimeline, locate, planDay, requiredPaths, type TimelineEntry, type TimelineOptions } from './engine';
import { scanLibrary } from './library';
import { locateReal, resolveFromStart, type TimelineOf } from './modes';
import { memorySource } from './test-helpers';
import type { Interstitial, Library, Schedule } from './types';

// Bumpers around the commercial breaks: docs/biblioteca.md ("Vinhetas de intervalo") and docs/grade.md.

const GRADE = `
nome: Teste
data_inicio: 2003-03-03
blocos:
  - horario: "08:00"
    itens:
      - programa: dbz
`;

const TWO_EPISODES = `
nome: Dois
data_inicio: 2003-03-03
blocos:
  - horario: "08:00"
    itens:
      - programa: dbz
        episodios: 2
`;

const CARTOON = `
nome: Cartoon
data_inicio: 2003-03-03
vinhetas_intervalo: intervalos/cartoon-network
blocos:
  - horario: "08:00"
    itens:
      - programa: dbz
        episodios: 2
`;

const GLOBINHO_ONLY = `
nome: Globinho
data_inicio: 2003-03-03
vinhetas_intervalo: intervalos/tv-globinho/
blocos:
  - horario: "08:00"
    itens:
      - programa: dbz
        episodios: 2
`;

const ONE_FILE = `
nome: Arquivo
data_inicio: 2003-03-03
vinhetas_intervalo: intervalos/tv-globinho/entrada-1.mp4
blocos:
  - horario: "08:00"
    itens:
      - programa: dbz
`;

const MISSING = `
nome: Faltando
data_inicio: 2003-03-03
vinhetas_intervalo: intervalos/nickelodeon
blocos:
  - horario: "08:00"
    itens:
      - programa: dbz
`;

const FILES: Record<string, string> = {
  'programas/dbz/programa.yaml': 'titulo: DBZ',
  'programas/dbz/episodios/001.mp4': '',
  'programas/dbz/episodios/002.mp4': '',
  'programas/dbz/episodios/003.mp4': '',
  'vinhetas/comerciais/c1.mp4': '',
  'vinhetas/comerciais/c2.mp4': '',
  'vinhetas/comerciais/c3.mp4': '',
  'vinhetas/comerciais/c4.mp4': '',
  'vinhetas/intervalos/tv-globinho/entrada-1.mp4': '',
  'vinhetas/intervalos/tv-globinho/entrada-2.mp4': '',
  'vinhetas/intervalos/tv-globinho/saida-1.mp4': '',
  'vinhetas/intervalos/tv-globinho/volta-generica.mp4': '',
  'vinhetas/intervalos/cartoon-network/Entrada.mp4': '',
  'vinhetas/intervalos/cartoon-network/Saída.mp4': '',
  'vinhetas/intervalos/solta.mp4': '',
  'grades/teste.yaml': GRADE,
  'grades/dois.yaml': TWO_EPISODES,
  'grades/cartoon.yaml': CARTOON,
  'grades/globinho.yaml': GLOBINHO_ONLY,
  'grades/arquivo.yaml': ONE_FILE,
  'grades/faltando.yaml': MISSING,
};

const BREAKS = { every: 8, ads: 3, afterEpisode: true, bumpers: true };
const EPISODE = 22 * 60;
const AD = 30;
const BUMPER = 5;

const durationOf = (path: string) => (path.includes('/episodios/') ? EPISODE : path.includes('/comerciais/') ? AD : BUMPER);

async function setup(files: Record<string, string> = FILES) {
  const lib = await scanLibrary(memorySource(files));
  const grade = (id: string) => lib.schedules.find((s) => s.id === id)!;
  return { lib, grade };
}

function timeline(lib: Library, schedule: Schedule, options: TimelineOptions = { adBreaks: BREAKS }, date = '2003-03-03', plan = {}) {
  return buildTimeline(planDay(schedule, lib, date, plan), durationOf, options);
}

const brandOf = (path: string) => path.split('/')[2]!;

/** The breaks of a timeline: runs of consecutive inBreak entries. */
function breaksOf(entries: readonly TimelineEntry[]): TimelineEntry[][] {
  const breaks: TimelineEntry[][] = [];
  entries.forEach((entry, i) => {
    if (!entry.inBreak) return;
    if (i > 0 && entries[i - 1]!.inBreak) breaks.at(-1)!.push(entry);
    else breaks.push([entry]);
  });
  return breaks;
}

const isBumper = (entry: TimelineEntry) => entry.path!.includes('/intervalos/');

function dates(count: number, from = '2003-03-03'): string[] {
  const start = new Date(`${from}T12:00:00Z`);
  return Array.from({ length: count }, (_, i) => new Date(start.getTime() + i * 86_400_000).toISOString().slice(0, 10));
}

describe('bumperRole', () => {
  it('reads the role from the file name, ignoring case, accents and extension', () => {
    expect(bumperRole('vinhetas/intervalos/tv-globinho/entrada-1.mp4')).toBe('entry');
    expect(bumperRole('vinhetas/intervalos/x/ENTRADA.MP4')).toBe('entry');
    expect(bumperRole('vinhetas/intervalos/x/volta_saida.mp4')).toBe('exit');
    expect(bumperRole('vinhetas/intervalos/x/Saída 2.mp4')).toBe('exit');
    expect(bumperRole('vinhetas/intervalos/x/saida01.mp4')).toBe('exit');
    expect(bumperRole('vinhetas/intervalos/x/globinho volta já.mp4')).toBe('any');
  });

  it('matches whole words only, and treats both words (or none) as generic', () => {
    expect(bumperRole('a/entradas.mp4')).toBe('any');
    expect(bumperRole('a/reentrada.mp4')).toBe('any');
    expect(bumperRole('a/saidas.mp4')).toBe('any');
    expect(bumperRole('a/entrada e saida.mp4')).toBe('any');
  });

  it('looks at the file name, not at the folders', () => {
    expect(bumperRole('vinhetas/intervalos/entrada/qualquer.mp4')).toBe('any');
  });
});

describe('groupBumpers', () => {
  const item = (relativePath: string): Interstitial => ({
    path: `vinhetas/${relativePath}`,
    category: relativePath.split('/')[0]!,
    relativePath,
  });

  it('makes one group per brand folder, and one for loose files', () => {
    const groups = groupBumpers([
      item('intervalos/tv-globinho/entrada.mp4'),
      item('intervalos/tv-globinho/2005/saida.mp4'),
      item('intervalos/Cartoon-Network/a.mp4'),
      item('intervalos/solta.mp4'),
    ]);
    expect(groups.map((g) => [g.id, g.items.length])).toEqual([
      ['intervalos/tv-globinho', 2],
      ['intervalos/cartoon-network', 1],
      ['intervalos', 1],
    ]);
  });

  it('offers tagged files to their side and generic ones to both', () => {
    const [group] = groupBumpers([
      item('intervalos/b/entrada.mp4'),
      item('intervalos/b/saida.mp4'),
      item('intervalos/b/geral.mp4'),
    ]);
    expect(bumpersOf(group!)).toEqual({
      group: 'intervalos/b',
      entry: ['vinhetas/intervalos/b/entrada.mp4', 'vinhetas/intervalos/b/geral.mp4'],
      exit: ['vinhetas/intervalos/b/saida.mp4', 'vinhetas/intervalos/b/geral.mp4'],
    });
  });
});

describe('breaks framed by bumpers', () => {
  it('goes entrada, commercials, saida in every break', async () => {
    const { lib, grade } = await setup();
    const tl = timeline(lib, grade('teste'));
    const breaks = breaksOf(tl.entries);
    // Two inside the episode plus the one after it.
    expect(breaks).toHaveLength(3);
    for (const entries of breaks) {
      expect(entries).toHaveLength(1 + 3 + 1);
      expect(entries.map(isBumper)).toEqual([true, false, false, false, true]);
      expect(bumperRole(entries[0]!.path!)).not.toBe('exit');
      expect(bumperRole(entries[4]!.path!)).not.toBe('entry');
      for (const bumper of [entries[0]!, entries[4]!]) {
        expect(bumper.kind).toBe('interstitial');
        expect(bumper.item).toMatchObject({ kind: 'interstitial', category: 'intervalos' });
      }
      expect(entries.slice(1, 4).every((e) => e.item?.kind === 'interstitial' && e.item.category === 'comerciais')).toBe(true);
    }
  });

  it('adds the bumpers to the length of the day', async () => {
    const { lib, grade } = await setup();
    const withBumpers = timeline(lib, grade('teste'));
    const without = timeline(lib, grade('teste'), { adBreaks: { ...BREAKS, bumpers: false } });
    expect(withBumpers.end - withBumpers.start).toBeCloseTo(without.end - without.start + 3 * 2 * BUMPER, 6);
  });

  it('never mixes brands inside a break, nor inside a day', async () => {
    const { lib, grade } = await setup();
    for (const date of dates(40)) {
      const tl = timeline(lib, grade('dois'), { adBreaks: BREAKS }, date);
      const brands = new Set<string>();
      for (const entries of breaksOf(tl.entries)) {
        const bumpers = entries.filter(isBumper);
        expect(bumpers.length).toBeGreaterThan(0);
        for (const bumper of bumpers) brands.add(brandOf(bumper.path!));
      }
      expect(brands.size).toBe(1);
    }
  });

  it('draws one brand per day: stable for the same day and channel, varied across days', async () => {
    const { lib, grade } = await setup();
    const groupOn = (date: string) => planDay(grade('dois'), lib, date).breakBumpers.group;
    const days = dates(40);
    expect(days.map(groupOn)).toEqual(days.map(groupOn));
    expect(new Set(days.map(groupOn))).toEqual(new Set(['intervalos/tv-globinho', 'intervalos/cartoon-network', 'intervalos']));
    // Same plan and same bumpers when the timeline is built twice.
    const first = timeline(lib, grade('dois'), { adBreaks: BREAKS }, days[3]!);
    const second = timeline(lib, grade('dois'), { adBreaks: BREAKS }, days[3]!);
    expect(second.entries.map((e) => e.path)).toEqual(first.entries.map((e) => e.path));
  });

  it('keeps the days-off rule: a rerun day uses the bumpers of the airing day', async () => {
    const { lib } = await setup({
      ...FILES,
      'grades/semana.yaml': GRADE.replace('nome: Teste', 'nome: Semana\ndias: [seg]'),
    });
    const semana = lib.schedules.find((s) => s.id === 'semana')!;
    const monday = planDay(semana, lib, '2003-03-03');
    const tuesday = planDay(semana, lib, '2003-03-04');
    expect(tuesday.date).toBe('2003-03-03');
    expect(tuesday.breakBumpers).toEqual(monday.breakBumpers);
  });

  it('does not change the commercials or the episodes that were picked', async () => {
    const { lib, grade } = await setup();
    const picks = (bumpers: boolean) =>
      timeline(lib, grade('dois'), { adBreaks: { ...BREAKS, bumpers } }, '2003-03-05')
        .entries.filter((e) => !isBumper(e) && e.kind !== 'filler')
        .map((e) => e.path);
    expect(picks(true)).toEqual(picks(false));
  });

  it('avoids the same bumper twice in a row when there are alternatives', async () => {
    const { lib, grade } = await setup();
    for (const date of dates(6)) {
      const tl = timeline(lib, grade('globinho'), { adBreaks: BREAKS }, date);
      const bumpers = breaksOf(tl.entries).map((entries) => ({ entry: entries[0]!.path, exit: entries.at(-1)!.path }));
      expect(bumpers.length).toBeGreaterThan(3);
      bumpers.forEach((current, i) => {
        expect(current.entry).not.toBe(current.exit);
        if (i > 0) expect(current.entry).not.toBe(bumpers[i - 1]!.entry);
      });
    }
  });
});

describe('vinhetas_intervalo in the schedule', () => {
  it('pins the bumpers to the subfolder, whatever the day', async () => {
    const { lib, grade } = await setup();
    for (const date of dates(12)) {
      const plan = planDay(grade('cartoon'), lib, date);
      expect(plan.breakBumpers).toEqual({
        group: 'intervalos/cartoon-network',
        entry: ['vinhetas/intervalos/cartoon-network/Entrada.mp4'],
        exit: ['vinhetas/intervalos/cartoon-network/Saída.mp4'],
      });
    }
    const tl = timeline(lib, grade('cartoon'));
    expect(tl.entries.filter(isBumper).every((e) => brandOf(e.path!) === 'cartoon-network')).toBe(true);
  });

  it('accepts a trailing slash and a single file (which then serves only its own side)', async () => {
    const { lib, grade } = await setup();
    expect(grade('globinho').breakBumpersRef).toBe('intervalos/tv-globinho');
    expect(planDay(grade('globinho'), lib, '2003-03-03').breakBumpers.group).toBe('intervalos/tv-globinho');

    const one = planDay(grade('arquivo'), lib, '2003-03-03').breakBumpers;
    expect(one.entry).toEqual(['vinhetas/intervalos/tv-globinho/entrada-1.mp4']);
    expect(one.exit).toEqual([]);
    const entries = breaksOf(timeline(lib, grade('arquivo')).entries);
    expect(entries.every((b) => isBumper(b[0]!) && !isBumper(b.at(-1)!))).toBe(true);
  });

  it('warns when it points to nothing, and falls back to the daily draw', async () => {
    const { lib, grade } = await setup();
    const warning = lib.warnings.find((w) => w.message.includes('vinhetas_intervalo'));
    expect(warning?.path).toBe('grades/faltando.yaml');
    expect(warning?.message).toContain('intervalos/nickelodeon');
    expect(planDay(grade('faltando'), lib, '2003-03-03').breakBumpers.group).not.toBe('');
    // The valid ones raise no warning.
    expect(lib.warnings.filter((w) => w.message.includes('vinhetas_intervalo'))).toHaveLength(1);
  });

  it('ignores (with a warning) a value that is not a path', async () => {
    const { lib } = await setup({ ...FILES, 'grades/ruim.yaml': GRADE.replace('nome: Teste', 'nome: Ruim\nvinhetas_intervalo: [a, b]') });
    expect(lib.schedules.find((s) => s.id === 'ruim')!.breakBumpersRef).toBeUndefined();
    expect(lib.warnings.some((w) => w.path === 'grades/ruim.yaml' && w.message.includes('"vinhetas_intervalo" deve ser'))).toBe(true);
  });

  it('applies to channels without the key too: auto and per-show channels draw a brand per day', async () => {
    const { lib } = await setup();
    const auto = createAutoSchedule(lib)!;
    expect(planDay(auto, lib, '2003-03-03').breakBumpers.group).not.toBe('');
  });
});

describe('missing entrada or saida', () => {
  /** The fixture with its bumpers replaced by these files in one brand folder. */
  const filesWith = (names: string[]) => ({
    ...Object.fromEntries(Object.entries(FILES).filter(([path]) => !path.includes('/intervalos/'))),
    ...Object.fromEntries(names.map((name) => [`vinhetas/intervalos/marca/${name}`, ''])),
  });

  it('skips the entering bumper when the brand has no entrada or generic file', async () => {
    const { lib, grade } = await setup(filesWith(['saida-a.mp4']));
    const breaks = breaksOf(timeline(lib, grade('teste')).entries);
    expect(breaks.length).toBeGreaterThan(0);
    for (const entries of breaks) {
      expect(entries.map(isBumper)).toEqual([false, false, false, true]);
      expect(entries.at(-1)!.path).toContain('saida-a');
    }
  });

  it('skips the coming-back bumper when the brand has no saida or generic file', async () => {
    const { lib, grade } = await setup(filesWith(['entrada-a.mp4']));
    for (const entries of breaksOf(timeline(lib, grade('teste')).entries)) {
      expect(entries.map(isBumper)).toEqual([true, false, false, false]);
    }
  });

  it('uses a generic file on both sides when that is all there is', async () => {
    const { lib, grade } = await setup(filesWith(['volta-ja.mp4']));
    for (const entries of breaksOf(timeline(lib, grade('teste')).entries)) {
      expect(entries.map(isBumper)).toEqual([true, false, false, false, true]);
      expect(entries[0]!.path).toBe(entries.at(-1)!.path);
    }
  });

  it('plays plain breaks when the library has no bumpers at all', async () => {
    const { lib, grade } = await setup(filesWith([]));
    const plan = planDay(grade('teste'), lib, '2003-03-03');
    expect(plan.breakBumpers).toEqual({ group: '', entry: [], exit: [] });
    for (const entries of breaksOf(buildTimeline(plan, durationOf, { adBreaks: BREAKS }).entries)) expect(entries).toHaveLength(3);
  });

  it('skips a bumper whose duration is unknown', async () => {
    const { lib, grade } = await setup();
    const plan = planDay(grade('cartoon'), lib, '2003-03-03');
    const tl = buildTimeline(plan, (path) => (path.endsWith('Entrada.mp4') ? undefined : durationOf(path)), { adBreaks: BREAKS });
    for (const entries of breaksOf(tl.entries)) expect(entries.map(isBumper)).toEqual([false, false, false, true]);
  });
});

describe('switching bumpers off', () => {
  it('adBreaks.bumpers: false leaves plain breaks', async () => {
    const { lib, grade } = await setup();
    const plan = planDay(grade('teste'), lib, '2003-03-03');
    const tl = buildTimeline(plan, durationOf, { adBreaks: { ...BREAKS, bumpers: false } });
    expect(tl.entries.some(isBumper)).toBe(false);
    expect(breaksOf(tl.entries).every((b) => b.length === 3)).toBe(true);
  });

  it('the bumpers option of planDay leaves nothing to probe', async () => {
    const { lib, grade } = await setup();
    const plan = planDay(grade('teste'), lib, '2003-03-03', { bumpers: false });
    expect(plan.breakBumpers).toEqual({ group: '', entry: [], exit: [] });
    expect(requiredPaths(plan).some((p) => p.includes('/intervalos/') && !plan.fillers.includes(p))).toBe(false);
    expect(buildTimeline(plan, durationOf, { adBreaks: BREAKS }).entries.some(isBumper)).toBe(false);
  });

  it('commercials off: no breaks, so no bumpers', async () => {
    const { lib, grade } = await setup();
    const plan = planDay(grade('teste'), lib, '2003-03-03', { commercials: false });
    expect(plan.breakBumpers.entry).toEqual([]);
    const tl = buildTimeline(plan, durationOf, { adBreaks: BREAKS });
    expect(tl.entries.filter((e) => e.inBreak)).toEqual([]);
    expect(tl.entries.some(isBumper)).toBe(false);
  });

  it('the global vinhetas switch (interstitials) takes the bumpers away too', async () => {
    const { lib, grade } = await setup();
    const plan = planDay(grade('teste'), lib, '2003-03-03', { interstitials: false });
    expect(plan.breakBumpers.group).toBe('');
    const tl = buildTimeline(plan, durationOf, { adBreaks: BREAKS });
    expect(tl.entries.some(isBumper)).toBe(false);
    // The commercials stay.
    expect(breaksOf(tl.entries).every((b) => b.length === 3)).toBe(true);
  });

  it('a break-less run (no adBreaks option) has no bumpers either', async () => {
    const { lib, grade } = await setup();
    const tl = buildTimeline(planDay(grade('teste'), lib, '2003-03-03'), durationOf);
    expect(tl.entries.filter((e) => e.kind === 'episode')).toHaveLength(1);
    expect(tl.entries.some((e) => e.inBreak)).toBe(false);
  });
});

describe('requiredPaths', () => {
  it('includes the bumpers of the day so their durations get probed', async () => {
    const { lib, grade } = await setup();
    const plan = planDay(grade('cartoon'), lib, '2003-03-03');
    const paths = requiredPaths(plan);
    expect(paths).toContain('vinhetas/intervalos/cartoon-network/Entrada.mp4');
    expect(paths).toContain('vinhetas/intervalos/cartoon-network/Saída.mp4');
    expect(new Set(paths).size).toBe(paths.length);
  });
});

describe('finding a position in a break with bumpers', () => {
  async function pinned() {
    const { lib, grade } = await setup();
    const options = { adBreaks: BREAKS, keepLongGaps: true };
    const tl = timeline(lib, grade('cartoon'), options);
    // First break starts at 440: bumper 440-445, ads 445-535, bumper 535-540, part 2 from 540.
    return { lib, grade, options, tl };
  }

  it('locate lands in the entering bumper, the commercials, the coming-back bumper and the next part', async () => {
    const { tl } = await pinned();
    const at = (seconds: number) => {
      const position = locate(tl, tl.start + seconds)!;
      return { entry: tl.entries[position.index]!, offset: position.offset };
    };
    const entering = at(442);
    expect(entering.entry.path).toContain('Entrada');
    expect(entering.entry.inBreak).toBe(true);
    expect(entering.offset).toBeCloseTo(2, 6);

    expect(at(445 + 40).entry.path).toContain('/comerciais/');
    expect(at(445 + 40).offset).toBeCloseTo(10, 6);

    const coming = at(537);
    expect(coming.entry.path).toContain('Sa');
    expect(coming.offset).toBeCloseTo(2, 6);

    const resumed = at(540 + 100);
    expect(resumed.entry.part).toEqual({ index: 2, count: 3 });
    expect(resumed.offset).toBeCloseTo(100, 6);
    // The episode resumes where it stopped, in the same file.
    expect(resumed.entry.fileOffset).toBeCloseTo(440, 6);
  });

  it('keeps the timeline gapless', async () => {
    const { tl } = await pinned();
    tl.entries.forEach((entry, i) => {
      if (i > 0) expect(entry.start).toBeCloseTo(tl.entries[i - 1]!.start + tl.entries[i - 1]!.duration, 6);
    });
  });

  it('locateReal and resolveFromStart handle them like any other entry', async () => {
    const { lib, grade, options, tl } = await pinned();
    const real = locateReal(tl, tl.start + 442);
    expect(real.offAir).toBe(false);
    if (!real.offAir) expect(tl.entries[real.index]!.path).toContain('Entrada');

    const g = grade('cartoon');
    const timelineOf: TimelineOf = (date) => timeline(lib, g, { ...options, maxGapFill: 0 }, date);
    const tuned = (await resolveFromStart(g, '2003-03-03', 537, timelineOf))!;
    expect(tuned.timeline.entries[tuned.index]!.path).toContain('Sa');
    expect(tuned.offset).toBeCloseTo(2, 6);
  });
});

describe('schedule items of category intervalos', () => {
  it('still play where the schedule puts them, outside the breaks', async () => {
    const { lib } = await setup({
      ...FILES,
      'grades/escrita.yaml': `
nome: Escrita
data_inicio: 2003-03-03
blocos:
  - horario: "08:00"
    itens:
      - vinheta: intervalos/solta.mp4
      - programa: dbz
`,
    });
    const schedule = lib.schedules.find((s) => s.id === 'escrita')!;
    const tl = timeline(lib, schedule);
    const first = tl.entries[0]!;
    expect(first.path).toBe('vinhetas/intervalos/solta.mp4');
    expect(first.inBreak).toBeUndefined();
  });
});
