import { describe, expect, it } from 'vitest';
import { breakPoints, buildTimeline, filePosition, locate, planDay, requiredPaths, type TimelineEntry, type TimelineOptions } from './engine';
import { scanLibrary } from './library';
import { locateReal, resolveFromStart, resolveReal, type TimelineOf } from './modes';
import { memorySource } from './test-helpers';
import type { Library, Schedule } from './types';

// Commercial breaks: docs/grade.md ("Intervalos comerciais").

// 2003-03-03 was a Monday.
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
      - vinheta: aberturas
      - programa: dbz
        episodios: 2
      - vinheta: encerramentos
`;

const EXPLICIT_ADS = `
nome: Explicito
data_inicio: 2003-03-03
blocos:
  - horario: "08:00"
    itens:
      - programa: dbz
      - comerciais: 2
      - programa: dbz
`;

const GAPS = `
nome: Vazios
data_inicio: 2003-03-03
blocos:
  - horario: "08:00"
    itens:
      - programa: dbz
  - horario: "09:00"
    itens:
      - programa: dbz
`;

const FILES: Record<string, string> = {
  'programas/dbz/programa.yaml': 'titulo: DBZ',
  'programas/dbz/episodios/001.mp4': '',
  'programas/dbz/episodios/002.mp4': '',
  'programas/dbz/episodios/003.mp4': '',
  'vinhetas/aberturas/a1.mp4': '',
  'vinhetas/encerramentos/e1.mp4': '',
  'vinhetas/intervalos/i1.mp4': '',
  'vinhetas/comerciais/c1.mp4': '',
  'vinhetas/comerciais/c2.mp4': '',
  'vinhetas/comerciais/c3.mp4': '',
  'vinhetas/comerciais/c4.mp4': '',
  'grades/teste.yaml': GRADE,
  'grades/dois.yaml': TWO_EPISODES,
  'grades/explicito.yaml': EXPLICIT_ADS,
  'grades/vazios.yaml': GAPS,
};

const BREAKS = { every: 8, ads: 3, afterEpisode: true };
const EPISODE = 22 * 60; // 1320 s
const AD = 30;

const durationOf = (path: string) => (path.includes('/episodios/') ? EPISODE : AD);

async function setup(files: Record<string, string> = FILES) {
  const lib = await scanLibrary(memorySource(files));
  const grade = (id: string) => lib.schedules.find((s) => s.id === id)!;
  return { lib, grade };
}

function timeline(
  lib: Library,
  schedule: Schedule,
  options: TimelineOptions = { adBreaks: BREAKS },
  date = '2003-03-03',
  plan: { commercials?: boolean } = {},
) {
  return buildTimeline(planDay(schedule, lib, date, plan), durationOf, options);
}

const describeEntry = (e: TimelineEntry) =>
  e.kind === 'episode' ? (e.part ? `ep${e.part.index}` : 'episode') : e.inBreak ? 'ad' : e.kind;

describe('breakPoints', () => {
  it('spreads floor(duration / every) breaks evenly, like the acts of a real show', () => {
    expect(breakPoints(22 * 60, 8)).toEqual([440, 880]);
    expect(breakPoints(21 * 60 + 30, 10)).toEqual([430, 860]);
    expect(breakPoints(30 * 60, 15)).toEqual([600, 1200]);
    expect(breakPoints(30 * 60, 20)).toEqual([900]);
  });

  it('leaves episodes shorter than every + 2 minutes untouched', () => {
    expect(breakPoints(8 * 60 + 119, 8)).toEqual([]);
    expect(breakPoints(8 * 60 + 120, 8)).toEqual([300]);
    expect(breakPoints(5 * 60, 8)).toEqual([]);
    expect(breakPoints(60, 8)).toEqual([]);
  });

  it('does nothing when every is 0, or the duration is unusable', () => {
    expect(breakPoints(22 * 60, 0)).toEqual([]);
    expect(breakPoints(22 * 60, 0, [300])).toEqual([]);
    expect(breakPoints(Number.NaN, 8)).toEqual([]);
  });

  it('never puts a break closer than 2 minutes to the start, the end or another break', () => {
    for (const every of [1, 2, 3, 5, 8, 10, 15, 30]) {
      for (let minutes = 1; minutes <= 120; minutes += 0.5) {
        const duration = minutes * 60;
        const points = breakPoints(duration, every);
        const edges = [0, ...points, duration];
        if (points.length > 0) for (let i = 1; i < edges.length; i++) expect(edges[i]! - edges[i - 1]!).toBeGreaterThanOrEqual(120);
        expect(points.length).toBeLessThanOrEqual(Math.floor(duration / (every * 60)));
      }
    }
  });

  it('uses the episode own points when given, dropping the ones outside the episode', () => {
    expect(breakPoints(EPISODE, 8, [850, 452])).toEqual([452, 850]);
    expect(breakPoints(EPISODE, 8, [0, 452, 452, EPISODE, EPISODE + 10, -5])).toEqual([452]);
    // Short episodes still honor them.
    expect(breakPoints(200, 30, [90])).toEqual([90]);
  });
});

describe('episodios.yaml intervalos', () => {
  it('reads cut points as mm:ss, h:mm:ss or seconds', async () => {
    const { lib } = await setup({
      ...FILES,
      'programas/dbz/episodios.yaml': `
"001":
  intervalos: ["7:32", "14:10"]
"002":
  intervalos: [90, "1:01:05", "10:00"]
"003":
  intervalos: "5:00"
`,
    });
    const dbz = lib.shows.find((s) => s.id === 'dbz')!;
    expect(dbz.episodes.map((e) => e.breaks)).toEqual([[452, 850], [90, 600, 3665], [300]]);
    expect(lib.warnings).toEqual([]);
  });

  it('warns about bad points and keeps the good ones', async () => {
    const { lib } = await setup({
      ...FILES,
      'programas/dbz/episodios.yaml': '"001":\n  intervalos: ["7:32", "logo", "-5", "1:2:3:4"]\n',
    });
    const dbz = lib.shows.find((s) => s.id === 'dbz')!;
    expect(dbz.episodes[0]!.breaks).toEqual([452]);
    expect(dbz.episodes[1]!.breaks).toBeUndefined();
    const messages = lib.warnings.map((w) => w.message);
    expect(messages).toHaveLength(3);
    expect(messages[0]).toContain('001.mp4');
    expect(lib.warnings[0]!.path).toBe('programas/dbz/episodios.yaml');
  });

  it('cuts the episode exactly there, whatever its length', async () => {
    const { lib, grade } = await setup({
      ...FILES,
      'programas/dbz/episodios.yaml': '"001":\n  intervalos: ["7:32", "14:10"]\n',
    });
    const parts = timeline(lib, grade('teste')).entries.filter((e) => e.kind === 'episode');
    expect(parts.map((p) => [p.fileOffset, p.duration])).toEqual([
      [0, 452],
      [452, 398],
      [850, EPISODE - 850],
    ]);
  });

  it('ignores them when every is 0', async () => {
    const { lib, grade } = await setup({
      ...FILES,
      'programas/dbz/episodios.yaml': '"001":\n  intervalos: ["7:32"]\n',
    });
    const entries = timeline(lib, grade('teste'), { adBreaks: { ...BREAKS, every: 0 } }).entries;
    expect(entries.filter((e) => e.kind === 'episode')).toHaveLength(1);
  });
});

describe('buildTimeline with commercial breaks', () => {
  it('splits an episode into acts with a break between them and one after', async () => {
    const { lib, grade } = await setup();
    const tl = timeline(lib, grade('teste'));
    expect(tl.entries.map(describeEntry)).toEqual(['ep1', 'ad', 'ad', 'ad', 'ep2', 'ad', 'ad', 'ad', 'ep3', 'ad', 'ad', 'ad']);

    const parts = tl.entries.filter((e) => e.kind === 'episode');
    expect(parts.map((p) => p.part)).toEqual([
      { index: 1, count: 3 },
      { index: 2, count: 3 },
      { index: 3, count: 3 },
    ]);
    expect(parts.map((p) => p.fileOffset)).toEqual([0, 440, 880]);
    expect(parts.map((p) => p.duration)).toEqual([440, 440, 440]);
    expect(new Set(parts.map((p) => p.path)).size).toBe(1);
    // All parts share the same planned item: the OSD shows one episode.
    expect(new Set(parts.map((p) => p.item)).size).toBe(1);
  });

  it('keeps the timeline contiguous and the durations adding up', async () => {
    const { lib, grade } = await setup();
    const tl = timeline(lib, grade('teste'));
    tl.entries.slice(1).forEach((entry, i) => {
      const previous = tl.entries[i]!;
      expect(entry.start).toBeCloseTo(previous.start + previous.duration, 6);
    });
    expect(tl.end - tl.start).toBeCloseTo(EPISODE + 9 * AD, 6);
    const episodeTime = tl.entries.filter((e) => e.kind === 'episode').reduce((sum, e) => sum + e.duration, 0);
    expect(episodeTime).toBeCloseTo(EPISODE, 6);
  });

  it('marks break commercials as such, and draws them from the commercials folder', async () => {
    const { lib, grade } = await setup();
    const ads = timeline(lib, grade('teste')).entries.filter((e) => e.inBreak);
    expect(ads).toHaveLength(9);
    expect(ads.every((e) => e.kind === 'interstitial' && e.path!.startsWith('vinhetas/comerciais/'))).toBe(true);
    expect(ads.every((e) => e.item?.kind === 'interstitial')).toBe(true);
  });

  it('does not repeat a commercial within a break nor back to back between breaks', async () => {
    const { lib, grade } = await setup();
    const breaksOf = (ads: number) => {
      const breaks: string[][] = [];
      for (const entry of timeline(lib, grade('teste'), { adBreaks: { ...BREAKS, ads } }).entries) {
        if (entry.kind === 'episode') breaks.push([]);
        else breaks[breaks.length - 1]!.push(entry.path!);
      }
      return breaks;
    };
    // The pool has 4 commercials.
    for (const ads of [2, 3, 4]) {
      const breaks = breaksOf(ads);
      expect(breaks).toHaveLength(3);
      for (const group of breaks) expect(new Set(group).size).toBe(group.length);
      for (let i = 1; i < breaks.length; i++) expect(breaks[i]![0]).not.toBe(breaks[i - 1]!.at(-1));
    }
    // Two per break out of four: the next break uses the other two.
    const [first, second] = breaksOf(2);
    expect(first!.some((path) => second!.includes(path))).toBe(false);
  });

  it('repeats commercials only when the break is longer than the pool, never twice in a row', async () => {
    const { lib, grade } = await setup();
    const tl = timeline(lib, grade('teste'), { adBreaks: { ...BREAKS, ads: 10 } });
    const ads = tl.entries.filter((e) => e.inBreak).map((e) => e.path);
    expect(ads).toHaveLength(30);
    ads.forEach((path, i) => {
      if (i > 0) expect(path).not.toBe(ads[i - 1]);
    });
  });

  it('is deterministic, and varies with the day', async () => {
    const { lib, grade } = await setup();
    const a = timeline(lib, grade('teste'));
    expect(timeline(lib, grade('teste'))).toEqual(a);
    const otherDay = timeline(lib, grade('teste'), { adBreaks: BREAKS }, '2003-03-04');
    expect(otherDay.entries.map((e) => e.path)).not.toEqual(a.entries.map((e) => e.path));
  });

  it('skips the break after the episode when afterEpisode is off', async () => {
    const { lib, grade } = await setup();
    const tl = timeline(lib, grade('teste'), { adBreaks: { ...BREAKS, afterEpisode: false } });
    expect(tl.entries.map(describeEntry)).toEqual(['ep1', 'ad', 'ad', 'ad', 'ep2', 'ad', 'ad', 'ad', 'ep3']);
  });

  it('puts only the after-episode break on short episodes and with every = 0', async () => {
    const { lib, grade } = await setup();
    const plan = planDay(grade('teste'), lib, '2003-03-03');
    const short = buildTimeline(plan, (p) => (p.includes('/episodios/') ? 500 : AD), { adBreaks: BREAKS });
    expect(short.entries.map(describeEntry)).toEqual(['episode', 'ad', 'ad', 'ad']);
    expect(short.entries[0]!.part).toBeUndefined();
    expect(short.entries[0]!.fileOffset).toBeUndefined();

    const noMiddle = timeline(lib, grade('teste'), { adBreaks: { ...BREAKS, every: 0 } });
    expect(noMiddle.entries.map(describeEntry)).toEqual(['episode', 'ad', 'ad', 'ad']);
  });

  it('plays episodes whole, with no breaks, when commercials are off or adBreaks is absent', async () => {
    const { lib, grade } = await setup();
    const off = timeline(lib, grade('teste'), { adBreaks: BREAKS }, '2003-03-03', { commercials: false });
    expect(off.entries.map(describeEntry)).toEqual(['episode']);
    expect(off.end - off.start).toBe(EPISODE);

    expect(timeline(lib, grade('teste'), {}).entries.map(describeEntry)).toEqual(['episode']);

    // A library without commercials has no breaks either.
    const noAds = await setup(Object.fromEntries(Object.entries(FILES).filter(([path]) => !path.includes('comerciais'))));
    expect(timeline(noAds.lib, noAds.grade('teste')).entries.map(describeEntry)).toEqual(['episode']);
  });

  it('lists the commercials among the files whose duration is needed', async () => {
    const { lib, grade } = await setup();
    const plan = planDay(grade('teste'), lib, '2003-03-03');
    expect(plan.commercials).toHaveLength(4);
    for (const path of plan.commercials) expect(requiredPaths(plan)).toContain(path);
    expect(planDay(grade('teste'), lib, '2003-03-03', { commercials: false }).commercials).toEqual([]);
  });

  it('does not double up when the schedule has commercials right after the episode', async () => {
    const { lib, grade } = await setup();
    const tl = timeline(lib, grade('explicito'), { adBreaks: { ...BREAKS, every: 0 } });
    // ep, the 2 scheduled commercials (no extra break), ep, then its own break.
    expect(tl.entries.map((e) => (e.kind === 'episode' ? 'ep' : e.inBreak ? 'break' : 'sched'))).toEqual([
      'ep',
      'sched',
      'sched',
      'ep',
      'break',
      'break',
      'break',
    ]);
  });

  it('keeps explicit bumpers where the schedule put them, with the break before them', async () => {
    const { lib, grade } = await setup();
    const tl = timeline(lib, grade('dois'), { adBreaks: { ...BREAKS, every: 0 } });
    const label = (e: TimelineEntry) => (e.kind === 'episode' ? 'ep' : e.inBreak ? 'break' : (e.item as { category: string }).category);
    expect(tl.entries.map(label)).toEqual([
      'aberturas',
      'ep',
      'break',
      'break',
      'break',
      'ep',
      'break',
      'break',
      'break',
      'encerramentos',
    ]);
    expect(tl.end - tl.start).toBeCloseTo(2 * (EPISODE + 3 * AD) + 2 * AD, 6);
  });

  it('keeps filling short gaps between blocks, and starts the next block on time', async () => {
    const { lib, grade } = await setup();
    // Each block: episode 1320 + 3 ads = 1410 s; block 2 starts at 09:00.
    const tl = timeline(lib, grade('vazios'), { adBreaks: { ...BREAKS, every: 0 }, maxGapFill: 3600 });
    const second = tl.entries.filter((e) => e.kind === 'episode')[1]!;
    expect(second.start).toBe(9 * 3600);
    expect(tl.entries.some((e) => e.kind === 'filler')).toBe(true);
  });
});

describe('finding the file position inside a split episode', () => {
  it('locate lands in part 2 at the cut point plus the offset', async () => {
    const { lib, grade } = await setup();
    const tl = timeline(lib, grade('teste'));
    // Part 1: 0-440, ad 440-530, part 2 from 530 (file 440-880).
    const position = locate(tl, tl.start + 530 + 100)!;
    const entry = tl.entries[position.index]!;
    expect(entry.part).toEqual({ index: 2, count: 3 });
    expect(position.offset).toBeCloseTo(100, 6);
    expect(filePosition(entry, position.offset).time).toBeCloseTo(540, 6);
    expect(filePosition(entry, position.offset).path).toBe(entry.path);

    // In a commercial the position is plain.
    const inAd = locate(tl, tl.start + 440 + 10)!;
    expect(tl.entries[inAd.index]!.inBreak).toBe(true);
    expect(filePosition(tl.entries[inAd.index]!, inAd.offset).time).toBe(10);
  });

  it('locateReal and resolveReal land in part 2 with the right file offset', async () => {
    const { lib, grade } = await setup();
    const options = { adBreaks: BREAKS, keepLongGaps: true };
    const tl = timeline(lib, grade('teste'), options);
    const clock = tl.start + 530 + 45;
    const real = locateReal(tl, clock);
    expect(real.offAir).toBe(false);
    if (real.offAir) return;
    const entry = tl.entries[real.index]!;
    expect(entry.part?.index).toBe(2);
    expect(filePosition(entry, real.offset).time).toBeCloseTo(485, 6);

    const timelineOf: TimelineOf = (date) => timeline(lib, grade('teste'), options, date);
    const tuned = await resolveReal(grade('teste'), '2003-03-03', clock, timelineOf);
    expect(tuned && !tuned.offAir).toBe(true);
    if (!tuned || tuned.offAir) return;
    expect(tuned.timeline.entries[tuned.index]!.part?.index).toBe(2);
    expect(filePosition(tuned.timeline.entries[tuned.index]!, tuned.offset).time).toBeCloseTo(485, 6);
  });

  it('resolveFromStart (marathon) lands in part 3 and goes on to the next day', async () => {
    const { lib, grade } = await setup();
    const g = grade('teste');
    const timelineOf: TimelineOf = (date) => timeline(lib, g, { adBreaks: BREAKS, maxGapFill: 0 }, date);
    const length = EPISODE + 9 * AD;
    // Part 1 + ads + part 2 + ads = 440 + 90 + 440 + 90 = 1060 s; 20 s into part 3.
    const tuned = (await resolveFromStart(g, '2003-03-03', 1080, timelineOf))!;
    const entry = tuned.timeline.entries[tuned.index]!;
    expect(entry.part?.index).toBe(3);
    expect(filePosition(entry, tuned.offset).time).toBeCloseTo(900, 6);

    // One full day later it is the next episode, from its first part.
    const next = (await resolveFromStart(g, '2003-03-03', length + 5, timelineOf))!;
    expect(next.date).toBe('2003-03-04');
    const nextEntry = next.timeline.entries[next.index]!;
    expect(nextEntry.part?.index).toBe(1);
    expect(nextEntry.path).not.toBe(entry.path);
    expect(filePosition(nextEntry, next.offset).time).toBeCloseTo(5, 6);
  });
});
