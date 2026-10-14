import { describe, expect, it } from 'vitest';
import { buildTimeline, planDay, type Timeline } from './engine';
import { scanLibrary } from './library';
import {
  airingDate,
  isAiringDay,
  locateReal,
  nextAiringDate,
  nextOnAir,
  resolveFromStart,
  resolveReal,
  type TimelineOf,
} from './modes';
import { memorySource } from './test-helpers';
import type { Library, Schedule } from './types';

// 2003-03-03 was a Monday.
const MORNING = `
nome: Manha
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

const NIGHT = `
nome: Noite
data_inicio: 2003-03-03
dias: [seg, ter, qua, qui, sex]
blocos:
  - horario: "23:00"
    itens:
      - programa: dbz
        episodios: 2
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
      'vinhetas/aberturas/a1.mp4': '',
      'vinhetas/intervalos/i1.mp4': '',
      'vinhetas/comerciais/c1.mp4': '',
      'vinhetas/comerciais/c2.mp4': '',
      'grades/manha.yaml': MORNING,
      'grades/noite.yaml': NIGHT,
    }),
  );
}

const at = (hours: number, minutes = 0, seconds = 0) => hours * 3600 + minutes * 60 + seconds;

async function setup(id: 'manha' | 'noite' = 'manha') {
  const lib = await library();
  return { lib, grade: lib.schedules.find((s) => s.id === id)! };
}

const REAL = { keepLongGaps: true };
const MARATHON = { maxGapFill: 0 };

/** Every file lasts 100 s unless `durationOf` says otherwise. */
function timelineOf(
  schedule: Schedule,
  lib: Library,
  options: { keepLongGaps?: boolean; maxGapFill?: number } = REAL,
  durationOf: (path: string) => number | undefined = () => 100,
): TimelineOf {
  return (date) => buildTimeline(planDay(schedule, lib, date), durationOf, options);
}

describe('date helpers', () => {
  it('finds airing days and the next one across a weekend', async () => {
    const { grade } = await setup();
    expect(isAiringDay(grade, '2003-03-07')).toBe(true);
    expect(isAiringDay(grade, '2003-03-08')).toBe(false);
    expect(airingDate(grade, '2003-03-09')).toBe('2003-03-07');
    expect(airingDate(grade, '2003-03-05')).toBe('2003-03-05');
    expect(nextAiringDate(grade, '2003-03-07')).toBe('2003-03-10');
    expect(nextAiringDate(grade, '2003-03-03')).toBe('2003-03-04');
  });

  it('computes the next on-air moment across a weekend', async () => {
    const { grade } = await setup();
    expect(nextOnAir(grade, '2003-03-04')).toEqual({ date: '2003-03-05', weekday: 'qua', seconds: at(8), daysAhead: 1 });
    expect(nextOnAir(grade, '2003-03-07')).toEqual({ date: '2003-03-10', weekday: 'seg', seconds: at(8), daysAhead: 3 });
    expect(nextOnAir(grade, '2003-03-08')).toEqual({ date: '2003-03-10', weekday: 'seg', seconds: at(8), daysAhead: 2 });
    expect(nextOnAir(grade, '2003-03-09')).toEqual({ date: '2003-03-10', weekday: 'seg', seconds: at(8), daysAhead: 1 });
  });

  it('treats an empty `dias` as every day', async () => {
    const { grade } = await setup();
    const everyDay = { ...grade, days: [] };
    expect(isAiringDay(everyDay, '2003-03-08')).toBe(true);
    expect(nextAiringDate(everyDay, '2003-03-08')).toBe('2003-03-09');
  });
});

describe('locateReal', () => {
  it('finds the entry on air', async () => {
    const { lib, grade } = await setup();
    const timeline = (await timelineOf(grade, lib)('2003-03-03')) as Timeline;
    // 5 files from 08:00 (500 s), a long gap kept as a hole, 3 files from 09:00 (300 s).
    expect(timeline.start).toBe(at(8));
    expect(timeline.end).toBe(at(9, 5));

    expect(locateReal(timeline, at(8))).toEqual({ offAir: false, index: 0, offset: 0 });
    expect(locateReal(timeline, at(8, 1, 30))).toEqual({ offAir: false, index: 0, offset: 90 });
    expect(locateReal(timeline, at(8, 5))).toEqual({ offAir: false, index: 3, offset: 0 });
    expect(locateReal(timeline, at(9, 1))).toEqual({ offAir: false, index: 5, offset: 60 });
  });

  it('is off the air before the first block, in long gaps and after the last item', async () => {
    const { lib, grade } = await setup();
    const timeline = (await timelineOf(grade, lib)('2003-03-03')) as Timeline;
    expect(locateReal(timeline, 0)).toEqual({ offAir: true, resumesAt: at(8) });
    expect(locateReal(timeline, at(7, 59, 59))).toEqual({ offAir: true, resumesAt: at(8) });
    // Block 1 ends at 08:08:20.
    expect(locateReal(timeline, at(8, 8, 20))).toEqual({ offAir: true, resumesAt: at(9) });
    expect(locateReal(timeline, at(8, 30))).toEqual({ offAir: true, resumesAt: at(9) });
    expect(locateReal(timeline, at(9, 4, 59))).toMatchObject({ offAir: false });
    expect(locateReal(timeline, at(9, 5))).toEqual({ offAir: true, resumesAt: null });
    expect(locateReal(timeline, at(23))).toEqual({ offAir: true, resumesAt: null });
  });

  it('starts the next block late instead of cutting the one before', async () => {
    const { lib, grade } = await setup();
    // The second Bob episode lasts 70 min, so block 1 runs past 09:00.
    const long = (path: string) => (path === 'programas/bob/episodios/002.mp4' ? 4200 : 100);
    const timeline = (await timelineOf(grade, lib, REAL, long)('2003-03-03')) as Timeline;
    const bob = timeline.entries.find((e) => e.path === 'programas/bob/episodios/002.mp4')!;
    const index = timeline.entries.indexOf(bob) + 1;
    const next = timeline.entries[index]!;
    expect(next.start).toBe(bob.start + 4200);
    expect(next.start).toBeGreaterThan(at(9));
    // At 09:00 the long episode is still on, and the late block starts when it ends: no off-air in between.
    expect(locateReal(timeline, at(9, 0, 30))).toMatchObject({ offAir: false, offset: at(9, 0, 30) - bob.start });
    expect(locateReal(timeline, next.start - 1)).toMatchObject({ offAir: false });
    expect(locateReal(timeline, next.start)).toEqual({ offAir: false, index, offset: 0 });
  });

  it('fills gaps up to maxGapFill with bumpers instead of leaving a hole', async () => {
    const { lib, grade } = await setup();
    // Files of 60 s: block 1 ends 08:05; the 55 min gap is filled when the limit allows it.
    const timeline = (await timelineOf(grade, lib, { keepLongGaps: true, maxGapFill: 3600 }, () => 60)('2003-03-03')) as Timeline;
    expect(locateReal(timeline, at(8, 30))).toMatchObject({ offAir: false });
    expect(timeline.entries.find((e) => e.start >= at(9))!.start).toBe(at(9));
  });
});

describe('resolveReal', () => {
  it('is on air, in the middle of an item', async () => {
    const { lib, grade } = await setup();
    expect(await resolveReal(grade, '2003-03-04', at(8, 3, 20), timelineOf(grade, lib))).toMatchObject({
      offAir: false,
      date: '2003-03-04',
      index: 2,
      offset: 0,
      shift: 0,
    });
    expect(await resolveReal(grade, '2003-03-04', at(8, 2, 30), timelineOf(grade, lib))).toMatchObject({
      offAir: false,
      index: 1,
      offset: 50,
    });
  });

  it('is off the air before the first block: back today', async () => {
    const { lib, grade } = await setup();
    expect(await resolveReal(grade, '2003-03-04', at(6, 30), timelineOf(grade, lib))).toEqual({
      offAir: true,
      reason: 'beforeStart',
      resume: { date: '2003-03-04', weekday: 'ter', seconds: at(8), daysAhead: 0 },
    });
  });

  it('is off the air in a long gap between blocks: back at the next block', async () => {
    const { lib, grade } = await setup();
    expect(await resolveReal(grade, '2003-03-04', at(8, 30), timelineOf(grade, lib))).toEqual({
      offAir: true,
      reason: 'gap',
      resume: { date: '2003-03-04', weekday: 'ter', seconds: at(9), daysAhead: 0 },
    });
  });

  it('is off the air after the last item: back tomorrow', async () => {
    const { lib, grade } = await setup();
    expect(await resolveReal(grade, '2003-03-04', at(12), timelineOf(grade, lib))).toEqual({
      offAir: true,
      reason: 'ended',
      resume: { date: '2003-03-05', weekday: 'qua', seconds: at(8), daysAhead: 1 },
    });
  });

  it('is off the air all day on days off: back on Monday', async () => {
    const { lib, grade } = await setup();
    for (const [date, daysAhead] of [
      ['2003-03-08', 2],
      ['2003-03-09', 1],
    ] as const) {
      expect(await resolveReal(grade, date, at(8, 5), timelineOf(grade, lib))).toEqual({
        offAir: true,
        reason: 'dayOff',
        resume: { date: '2003-03-10', weekday: 'seg', seconds: at(8), daysAhead },
      });
    }
    // Friday after the show: back in three days.
    expect(await resolveReal(grade, '2003-03-07', at(20), timelineOf(grade, lib))).toMatchObject({
      offAir: true,
      resume: { weekday: 'seg', daysAhead: 3 },
    });
  });

  it('lets the last block run past midnight, then goes off the air', async () => {
    const { lib, grade: night } = await setup('noite');
    // Two episodes of 1 h from 23:00: the second one ends at 01:00.
    const build = timelineOf(night, lib, REAL, (path) => (path.includes('/episodios/') ? 3600 : 100));

    expect(await resolveReal(night, '2003-03-07', at(23, 30), build)).toMatchObject({
      offAir: false,
      date: '2003-03-07',
      index: 0,
      offset: 1800,
      shift: 0,
    });

    // Saturday 00:30 is still Friday's second episode, even though Saturday is a day off.
    expect(await resolveReal(night, '2003-03-08', at(0, 30), build)).toMatchObject({
      offAir: false,
      date: '2003-03-07',
      index: 1,
      offset: 1800,
      shift: 86400,
    });

    // Once the tail is over, the day off applies.
    expect(await resolveReal(night, '2003-03-08', at(1), build)).toMatchObject({
      offAir: true,
      reason: 'dayOff',
      resume: { weekday: 'seg', daysAhead: 2 },
    });

    // Monday 00:30: Sunday did not air, so there is no tail. Back at 23:00 the same day.
    expect(await resolveReal(night, '2003-03-10', at(0, 30), build)).toMatchObject({
      offAir: true,
      reason: 'beforeStart',
      resume: { date: '2003-03-10', seconds: at(23), daysAhead: 0 },
    });

    // Tuesday 00:30 is the tail of Monday's block.
    expect(await resolveReal(night, '2003-03-11', at(0, 30), build)).toMatchObject({ offAir: false, date: '2003-03-10', index: 1 });
  });

  it('returns null when an airing day has nothing playable', async () => {
    const { lib, grade } = await setup();
    expect(await resolveReal(grade, '2003-03-04', at(8, 5), timelineOf(grade, lib, REAL, () => undefined))).toBeNull();
  });

  it('is deterministic', async () => {
    const { lib, grade } = await setup();
    const first = await resolveReal(grade, '2026-10-13', at(8, 12), timelineOf(grade, lib));
    const second = await resolveReal(grade, '2026-10-13', at(8, 12), timelineOf(grade, lib));
    expect(second).toEqual(first);
  });
});

describe('resolveFromStart', () => {
  it('starts at the opening, ignoring the gaps between blocks', async () => {
    const { lib, grade } = await setup();
    const build = timelineOf(grade, lib, MARATHON);
    const start = await resolveFromStart(grade, '2003-03-04', 0, build);
    expect(start).toMatchObject({ date: '2003-03-04', index: 0, offset: 0 });
    expect(start!.timeline.entries[0]!.item?.kind).toBe('interstitial'); // the opening
    // 5 + 3 files back to back: the second block follows the first right away.
    expect(start!.timeline.end - start!.timeline.start).toBe(800);
    expect(start!.timeline.entries[5]!.start).toBe(start!.timeline.start + 500);
    expect(await resolveFromStart(grade, '2003-03-04', 550, build)).toMatchObject({ index: 5, offset: 50 });
  });

  it('continues with the next airing day, so the episodes advance', async () => {
    const { lib, grade } = await setup();
    const build = timelineOf(grade, lib, MARATHON);
    const first = await resolveFromStart(grade, '2003-03-04', 0, build);
    const second = await resolveFromStart(grade, '2003-03-04', 800 + 120, build);
    expect(second).toMatchObject({ date: '2003-03-05', index: 1, offset: 20 });
    const episode = (tune: typeof first) => tune!.timeline.entries.find((e) => e.item?.kind === 'episode')!.item;
    expect(episode(second)).not.toEqual(episode(first));
  });

  it('goes from Friday to Monday, and starts a day off with the last airing day', async () => {
    const { lib, grade } = await setup();
    const build = timelineOf(grade, lib, MARATHON);
    expect(await resolveFromStart(grade, '2003-03-07', 805, build)).toMatchObject({ date: '2003-03-10', index: 0, offset: 5 });
    expect(await resolveFromStart(grade, '2003-03-08', 0, build)).toMatchObject({ date: '2003-03-07', index: 0 });
    // Seven airing days after a Monday is the Wednesday of the next week.
    expect(await resolveFromStart(grade, '2003-03-03', 7 * 800 + 1, build)).toMatchObject({ date: '2003-03-12' });
  });

  it('is deterministic', async () => {
    const { lib, grade } = await setup();
    const build = timelineOf(grade, lib, MARATHON);
    expect(await resolveFromStart(grade, '2003-03-04', 1234, build)).toEqual(await resolveFromStart(grade, '2003-03-04', 1234, build));
  });

  it('returns null when nothing is playable', async () => {
    const { lib, grade } = await setup();
    expect(await resolveFromStart(grade, '2003-03-04', 0, timelineOf(grade, lib, MARATHON, () => undefined))).toBeNull();
  });
});
