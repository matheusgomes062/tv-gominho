import { describe, expect, it } from 'vitest';
import { createAutoSchedule } from './auto';
import { buildTimeline, locate, planDay, requiredPaths, type DayPlan } from './engine';
import { scanLibrary } from './library';
import { memorySource } from './test-helpers';
import type { Library } from './types';

// 2003-03-03 was a Monday.
const GRADE = `
nome: Teste
data_inicio: 2003-03-03
dias: [seg, ter, qua, qui, sex]
blocos:
  - horario: "08:00"
    itens:
      - vinheta: aberturas
      - programa: dbz
      - vinheta: intervalos
      - programa: bob
        episodios: 2
  - horario: "09:00"
    itens:
      - comerciais: 2
      - programa: dbz
`;

async function library(): Promise<Library> {
  return scanLibrary(
    memorySource({
      'programas/dbz/programa.yaml': 'titulo: DBZ',
      'programas/dbz/episodios/001.mp4': '',
      'programas/dbz/episodios/002.mp4': '',
      'programas/dbz/episodios/003.mp4': '',
      'programas/bob/programa.yaml': 'titulo: Bob',
      'programas/bob/episodios/001.mp4': '',
      'programas/bob/episodios/002.mp4': '',
      'programas/bob/episodios/003.mp4': '',
      'programas/bob/episodios/004.mp4': '',
      'programas/bob/episodios/005.mp4': '',
      'vinhetas/aberturas/a1.mp4': '',
      'vinhetas/aberturas/a2.mp4': '',
      'vinhetas/intervalos/i1.mp4': '',
      'vinhetas/intervalos/i2.mp4': '',
      'vinhetas/comerciais/c1.mp4': '',
      'vinhetas/comerciais/c2.mp4': '',
      'vinhetas/comerciais/c3.mp4': '',
      'grades/teste.yaml': GRADE,
    }),
  );
}

const episodes = (plan: DayPlan) =>
  plan.blocks.flatMap((b) => b.items).flatMap((item) => (item.kind === 'episode' ? [`${item.show.id}#${item.episodeIndex + 1}`] : []));

describe('planDay', () => {
  it('advances one episode per airing, counted from the premiere', async () => {
    const lib = await library();
    const grade = lib.schedules[0]!;
    // dbz airs twice a day, bob twice a day.
    expect(episodes(planDay(grade, lib, '2003-03-03'))).toEqual(['dbz#1', 'bob#1', 'bob#2', 'dbz#2']);
    expect(episodes(planDay(grade, lib, '2003-03-04'))).toEqual(['dbz#3', 'bob#3', 'bob#4', 'dbz#1']);
    expect(episodes(planDay(grade, lib, '2003-03-05'))).toEqual(['dbz#2', 'bob#5', 'bob#1', 'dbz#3']);
  });

  it('reruns the last airing day on days off', async () => {
    const lib = await library();
    const grade = lib.schedules[0]!;
    const friday = planDay(grade, lib, '2003-03-07');
    const saturday = planDay(grade, lib, '2003-03-08');
    const sunday = planDay(grade, lib, '2003-03-09');
    expect(saturday.date).toBe('2003-03-07');
    expect(sunday.date).toBe('2003-03-07');
    expect(saturday.blocks).toEqual(friday.blocks);
    expect(sunday.blocks).toEqual(friday.blocks);
  });

  it('works for days before the premiere', async () => {
    const lib = await library();
    const grade = lib.schedules[0]!;
    // The previous Friday is one airing before the premiere.
    expect(episodes(planDay(grade, lib, '2003-02-28'))).toEqual(['dbz#2', 'bob#4', 'bob#5', 'dbz#3']);
  });

  it('is deterministic, including random bumpers', async () => {
    const lib = await library();
    const grade = lib.schedules[0]!;
    expect(planDay(grade, lib, '2026-10-13')).toEqual(planDay(grade, lib, '2026-10-13'));
  });

  it('can leave out bumpers and commercials', async () => {
    const lib = await library();
    const grade = lib.schedules[0]!;
    const kinds = (plan: DayPlan) => plan.blocks.flatMap((b) => b.items).map((item) => item.kind);
    const noCommercials = planDay(grade, lib, '2003-03-03', { commercials: false });
    expect(kinds(noCommercials)).toEqual(['interstitial', 'episode', 'interstitial', 'episode', 'episode', 'episode']);
    expect(noCommercials.fillers.every((path) => path.includes('/intervalos/'))).toBe(true);

    const noBumpers = planDay(grade, lib, '2003-03-03', { interstitials: false });
    expect(kinds(noBumpers)).toEqual(['episode', 'episode', 'episode', 'interstitial', 'interstitial', 'episode']);
    expect(noBumpers.fillers.every((path) => path.includes('/comerciais/'))).toBe(true);

    const nothing = planDay(grade, lib, '2003-03-03', { interstitials: false, commercials: false });
    expect(kinds(nothing)).toEqual(['episode', 'episode', 'episode', 'episode']);
    expect(nothing.fillers).toEqual([]);
  });

  it('keeps the same episodes whatever is switched off', async () => {
    const lib = await library();
    const grade = lib.schedules[0]!;
    const episodes = (plan: DayPlan) =>
      plan.blocks.flatMap((b) => b.items).filter((item) => item.kind === 'episode').map((item) => item.path);
    const all = episodes(planDay(grade, lib, '2003-03-03'));
    expect(episodes(planDay(grade, lib, '2003-03-03', { interstitials: false, commercials: false }))).toEqual(all);
  });

  it('builds a timeline without bumper or commercial filler when they are off', async () => {
    const lib = await library();
    const grade = lib.schedules[0]!;
    const durationOf = () => 600;
    const plan = planDay(grade, lib, '2003-03-03', { interstitials: false, commercials: false });
    const timeline = buildTimeline(plan, durationOf);
    expect(timeline.entries.some((entry) => entry.kind === 'filler' || entry.kind === 'interstitial')).toBe(false);
  });

  it('lists every file whose duration is needed', async () => {
    const lib = await library();
    const plan = planDay(lib.schedules[0]!, lib, '2003-03-03');
    const paths = requiredPaths(plan);
    for (const block of plan.blocks) for (const item of block.items) expect(paths).toContain(item.path);
    for (const filler of plan.fillers) expect(paths).toContain(filler);
  });
});

describe('buildTimeline', () => {
  const durations = (overrides: Record<string, number> = {}) => (path: string) => {
    if (path in overrides) return overrides[path];
    if (path.includes('/episodios/')) return 600; // 10 min
    return 30;
  };

  it('fills short gaps with bumpers and starts the next block on time', async () => {
    const lib = await library();
    const plan = planDay(lib.schedules[0]!, lib, '2003-03-03');
    // Block 1: 30 + 600 + 30 + 600 + 600 = 1860 s -> ends 08:31. Gap until 09:00 is 29 min: too long, skipped.
    const skippedGap = buildTimeline(plan, durations());
    const block2 = skippedGap.entries.find((e) => e.item?.kind === 'interstitial' && e.path?.includes('comerciais'));
    expect(block2?.start).toBe(8 * 3600 + 1860);

    // With a 30 min limit, the 29 min gap is filled and block 2 starts at 09:00 sharp.
    const filled = buildTimeline(plan, durations(), { maxGapFill: 1800 });
    const fillers = filled.entries.filter((e) => e.kind === 'filler' || e.kind === 'idle');
    expect(fillers.length).toBeGreaterThan(0);
    const firstOfBlock2 = filled.entries.find((e) => e.start >= 9 * 3600)!;
    expect(firstOfBlock2.start).toBe(9 * 3600);
    // Entries are contiguous.
    filled.entries.slice(1).forEach((entry, i) => {
      const previous = filled.entries[i]!;
      expect(entry.start).toBeCloseTo(previous.start + previous.duration);
    });
  });

  it('starts the next block late instead of cutting an episode', async () => {
    const lib = await library();
    const plan = planDay(lib.schedules[0]!, lib, '2003-03-03');
    const timeline = buildTimeline(plan, durations({ 'programas/bob/episodios/002.mp4': 3000 }));
    const lastOfBlock1 = timeline.entries.find((e) => e.path === 'programas/bob/episodios/002.mp4')!;
    const next = timeline.entries[timeline.entries.indexOf(lastOfBlock1) + 1]!;
    expect(next.start).toBe(lastOfBlock1.start + 3000);
    expect(next.start).toBeGreaterThan(9 * 3600);
  });

  it('skips files with unknown duration', async () => {
    const lib = await library();
    const plan = planDay(lib.schedules[0]!, lib, '2003-03-03');
    const timeline = buildTimeline(plan, durations({ 'programas/dbz/episodios/001.mp4': Number.NaN }));
    expect(timeline.skipped).toEqual(['programas/dbz/episodios/001.mp4']);
    expect(timeline.entries.some((e) => e.path === 'programas/dbz/episodios/001.mp4')).toBe(false);
  });
});

describe('locate', () => {
  it('finds the entry on air and loops the day continuously', async () => {
    const lib = await library();
    const plan = planDay(lib.schedules[0]!, lib, '2003-03-03');
    const timeline = buildTimeline(plan, () => 100);
    // 5 + 3 = 8 files of 100 s from 08:00; the long gap before 09:00 is skipped.
    expect(timeline.end - timeline.start).toBe(800);

    expect(locate(timeline, 8 * 3600)).toEqual({ index: 0, offset: 0 });
    expect(locate(timeline, 8 * 3600 + 250)).toEqual({ index: 2, offset: 50 });
    // After the end, the day starts over.
    expect(locate(timeline, 8 * 3600 + 800 + 10)).toEqual({ index: 0, offset: 10 });
    // Before the first block, it is the end of the previous loop.
    expect(locate(timeline, 8 * 3600 - 10)).toEqual({ index: 7, offset: 90 });
  });

  it('returns null for an empty timeline', async () => {
    const lib = await library();
    const plan = planDay(lib.schedules[0]!, lib, '2003-03-03');
    expect(locate(buildTimeline(plan, () => undefined), 0)).toBeNull();
  });
});

describe('createAutoSchedule', () => {
  it('makes a channel from every show', async () => {
    const lib = await library();
    const auto = createAutoSchedule(lib)!;
    const plan = planDay(auto, lib, '2026-10-13');
    const kinds = plan.blocks[0]!.items.map((item) => (item.kind === 'episode' ? item.show.id : item.category));
    expect(kinds).toEqual(['aberturas', 'bob', 'dbz']);
  });
});
