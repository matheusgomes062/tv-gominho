import { DEFAULT_SETTINGS, scanLibrary, type Library, type LibrarySource } from '@tv-gominho/nucleo';
import { describe, expect, it } from 'vitest';
import {
  DAY_SECONDS,
  SLOT,
  WINDOW_SECONDS,
  blockAt,
  blockDetails,
  blockSpeech,
  buildGuide,
  dayFraction,
  focusedBlock,
  initialFocus,
  moveFocus,
  refocus,
  scrollWindow,
  slotLabels,
  windowFor,
  type Guide,
} from './guide-model';
import { buildWeekModel } from './week-model';

function memorySource(files: Record<string, string>): LibrarySource {
  return {
    files: Object.keys(files),
    async readText(path) {
      const text = files[path];
      if (text === undefined) throw new Error(`No such file: ${path}`);
      return text;
    },
  };
}

// 2003-03-03 is a Monday: dbz at 08:00 (22 min), two bobs after it (11 min each), then dbz again at 10:30; no weekend.
const GRADE = `nome: Manhãs
data_inicio: 2003-03-03
dias: [seg, ter, qua, qui, sex]
blocos:
  - horario: "08:00"
    itens:
      - programa: dbz
      - programa: bob
        episodios: 2
  - horario: "10:30"
    itens:
      - programa: dbz
`;
// dbz at 08:00 and 08:27 (five minutes of hole after the first, which ends at 08:22) and at 12:00 (a long hole).
const GAPS = `nome: Buracos
data_inicio: 2003-03-03
dias: [seg]
blocos:
  - horario: "08:00"
    itens:
      - programa: dbz
  - horario: "08:27"
    itens:
      - programa: dbz
  - horario: "12:00"
    itens:
      - programa: dbz
`;
const episodes = (show: string, count: number) => Object.fromEntries(Array.from({ length: count }, (_, i) => [`programas/${show}/episodios/${String(i + 1).padStart(3, '0')} - Titulo ${i + 1}.mp4`, '']));
const FILES: Record<string, string> = {
  'programas/dbz/programa.yaml': 'titulo: DBZ',
  ...episodes('dbz', 12),
  'programas/bob/programa.yaml': 'titulo: Bob Esponja',
  ...episodes('bob', 12),
  'grades/manhas.yaml': GRADE,
  'grades/buracos.yaml': GAPS,
};
const WEEK = ['2003-03-03', '2003-03-04', '2003-03-05', '2003-03-06', '2003-03-07', '2003-03-08', '2003-03-09'];
const durationOf = (path: string) => (path.includes('/dbz/') ? 22 * 60 : 11 * 60);
const hm = (h: number, m = 0) => h * 3600 + m * 60;
const OPTIONS = { settings: { ...DEFAULT_SETTINGS, commercials: false, interstitials: false }, durationOf };

async function guideOf(today = '2003-03-03', dates: string[] = WEEK, grade = 'Manhãs'): Promise<Guide> {
  const library: Library = await scanLibrary(memorySource(FILES));
  const schedule = library.schedules.find((entry) => entry.name === grade)!;
  return buildGuide(buildWeekModel(schedule, library, dates, { ...OPTIONS, today }));
}

describe('the rows of the guide', () => {
  it('has a row per day, with the blocks from where each episode starts to where it ends', async () => {
    const guide = await guideOf();
    expect(guide.rows).toHaveLength(7);
    expect(guide.rows[0]!.blocks.map((b) => [b.airing.showTitle, b.start, b.end])).toEqual([
      ['DBZ', hm(8), hm(8, 22)],
      ['Bob Esponja', hm(8, 22), hm(8, 33)],
      ['Bob Esponja', hm(8, 33), hm(8, 44)],
      ['DBZ', hm(10, 30), hm(10, 52)],
    ]);
    expect(guide.rows[0]!.blocks.map((b) => [b.row, b.index])).toEqual([
      [0, 0],
      [0, 1],
      [0, 2],
      [0, 3],
    ]);
  });

  it('says why a row has no blocks: a day off, or before the channel began', async () => {
    const guide = await guideOf();
    expect(guide.rows.map((row) => row.state)).toEqual(['airs', 'airs', 'airs', 'airs', 'airs', 'off', 'off']);
    expect(guide.rows[5]!.blocks).toEqual([]);
    const early = await guideOf('2003-03-03', ['2003-02-28', '2003-03-03']);
    expect(early.rows.map((row) => row.state)).toEqual(['before-start', 'airs']);
  });

  it('marks today', async () => {
    const guide = await guideOf('2003-03-05');
    expect(guide.rows.map((row) => row.today)).toEqual([false, false, true, false, false, false, false]);
  });

  it('never lets a block cover the start of the next', async () => {
    const guide = await guideOf();
    for (const row of guide.rows) {
      row.blocks.forEach((block, i) => {
        expect(block.end).toBeGreaterThan(block.start);
        if (i > 0) expect(block.start).toBeGreaterThanOrEqual(row.blocks[i - 1]!.end);
      });
    }
  });

  it('turns a short hole between two blocks into a break, and leaves a long one empty', async () => {
    const row = (await guideOf('2003-03-03', ['2003-03-03'], 'Buracos')).rows[0]!;
    expect(row.blocks.map((block) => [block.start, block.end])).toEqual([
      [hm(8), hm(8, 22)],
      [hm(8, 27), hm(8, 49)],
      [hm(12), hm(12, 22)],
    ]);
    expect(row.breaks).toEqual([{ start: hm(8, 22), end: hm(8, 27) }]);
  });
});

describe('the blocks at a moment', () => {
  it('finds the block that plays then, or the nearest one', async () => {
    const guide = await guideOf();
    const row = guide.rows[0]!;
    expect(blockAt(row, hm(8, 10))).toBe(0);
    expect(blockAt(row, hm(8, 22))).toBe(1);
    expect(blockAt(row, hm(9, 30))).toBe(2);
    expect(blockAt(row, hm(10, 20))).toBe(3);
    expect(blockAt(row, hm(3))).toBe(0);
    expect(blockAt(guide.rows[5]!, hm(8))).toBe(-1);
  });
});

describe('the focus', () => {
  it("starts on what plays now on today's row, or what comes next", async () => {
    const guide = await guideOf('2003-03-05');
    expect(initialFocus(guide, hm(8, 25))).toEqual({ row: 2, index: 1, time: hm(8, 22) });
    expect(initialFocus(guide, hm(9))).toEqual({ row: 2, index: 3, time: hm(10, 30) });
    expect(initialFocus(guide, hm(6))).toEqual({ row: 2, index: 0, time: hm(8) });
    // After the last block of the day: the last one.
    expect(initialFocus(guide, hm(23))).toEqual({ row: 2, index: 3, time: hm(10, 30) });
  });

  it('starts on the first block of the first day when today is not in the week', async () => {
    const guide = await guideOf('2003-04-01');
    expect(initialFocus(guide, hm(9))).toEqual({ row: 0, index: 0, time: hm(8) });
  });

  it('has no focus for a week with nothing on the air', async () => {
    const off = await guideOf('2003-03-03', ['2003-03-08', '2003-03-09']);
    expect(initialFocus(off, null)).toBeNull();
  });

  it('moves block to block with Left and Right and stops at the ends of the day', async () => {
    const guide = await guideOf();
    const right = moveFocus(guide, { row: 0, index: 0, time: hm(8) }, 'right')!;
    expect(right).toEqual({ row: 0, index: 1, time: hm(8, 22) });
    expect(moveFocus(guide, right, 'left')).toEqual({ row: 0, index: 0, time: hm(8) });
    expect(moveFocus(guide, { row: 0, index: 0, time: hm(8) }, 'left')).toBeNull();
    expect(moveFocus(guide, { row: 0, index: 3, time: hm(10, 30) }, 'right')).toBeNull();
  });

  it('moves to the block at the same time on the day above or below, skipping days with nothing', async () => {
    const guide = await guideOf();
    expect(moveFocus(guide, { row: 0, index: 2, time: hm(8, 33) }, 'down')).toEqual({ row: 1, index: 2, time: hm(8, 33) });
    expect(moveFocus(guide, { row: 0, index: 0, time: hm(8) }, 'up')).toBeNull();
    // Friday is the last day on the air: the weekend rows have no blocks, so there is nothing under it.
    expect(moveFocus(guide, { row: 4, index: 0, time: hm(8) }, 'down')).toBeNull();
  });

  it('skips a day off between two days on the air', async () => {
    const guide = await guideOf('2003-03-03', ['2003-03-07', '2003-03-08', '2003-03-09', '2003-03-10']);
    expect(moveFocus(guide, { row: 0, index: 0, time: hm(8) }, 'down')).toEqual({ row: 3, index: 0, time: hm(8) });
    expect(moveFocus(guide, { row: 3, index: 0, time: hm(8) }, 'up')).toEqual({ row: 0, index: 0, time: hm(8) });
  });

  it('remembers the moment across Up and Down', async () => {
    const guide = await guideOf();
    const start = { row: 0, index: 3, time: hm(10, 30) };
    const there = moveFocus(guide, start, 'down')!;
    expect(moveFocus(guide, there, 'up')).toEqual(start);
  });

  it('finds the block in focus and keeps the place when the week is built again', async () => {
    const guide = await guideOf();
    const block = focusedBlock(guide, { row: 1, index: 3, time: hm(10, 30) })!;
    expect(block.airing.showTitle).toBe('DBZ');
    expect(focusedBlock(guide, null)).toBeNull();
    expect(refocus(guide, { row: 1, index: 9, time: hm(10, 30) })).toEqual({ row: 1, index: 3, time: hm(10, 30) });
    // A row that has nothing now falls back to the start.
    expect(refocus(guide, { row: 5, index: 0, time: hm(8) })).toEqual({ row: 0, index: 0, time: hm(8) });
  });
});

describe('the window on the day', () => {
  it('starts a slot before the block it shows, inside the day', async () => {
    const block = (await guideOf()).rows[0]!.blocks[0]!;
    expect(windowFor(block)).toBe(hm(7, 30));
    expect(windowFor(null)).toBe(hm(8));
    expect(windowFor({ ...block, start: hm(23, 40), end: hm(23, 59) })).toBe(DAY_SECONDS - WINDOW_SECONDS);
    expect(windowFor({ ...block, start: 0, end: 600 })).toBe(0);
  });

  it('stays still while the focused block is all inside, and scrolls just enough when it is not', async () => {
    const row = (await guideOf()).rows[0]!;
    const start = hm(7, 30);
    expect(scrollWindow(start, row.blocks[1]!)).toBe(start);
    // The 10:30 block is past the right edge (09:30): its end comes in, on a slot.
    expect(scrollWindow(start, row.blocks[3]!)).toBe(hm(9));
    // And back: a slot of what comes before it.
    expect(scrollWindow(hm(10), row.blocks[1]!)).toBe(hm(7, 30));
  });

  it('shows the start of a block longer than the window', async () => {
    const block = (await guideOf()).rows[0]!.blocks[0]!;
    const long = { ...block, start: hm(8, 10), end: hm(13) };
    expect(scrollWindow(hm(7, 30), long)).toBe(hm(7, 30));
    expect(scrollWindow(hm(0), long)).toBe(hm(8));
  });

  it('labels every slot of the day and places times on it', () => {
    const labels = slotLabels();
    expect(labels).toHaveLength(48);
    expect(labels[17]).toEqual({ seconds: 17 * SLOT, label: '08:30', hour: false });
    expect(labels[16]!.hour).toBe(true);
    expect(dayFraction(hm(12))).toBe(0.5);
    expect(dayFraction(-5)).toBe(0);
  });
});

describe('the details strip', () => {
  it('says what, which episode, when and how long', async () => {
    const block = (await guideOf()).rows[0]!.blocks[1]!;
    expect(blockDetails(block)).toMatchObject({ show: 'Bob Esponja', episode: 'Ep. 1 · Titulo 1', span: '08:22–08:33', length: '11 min', pinned: false, blocked: false });
    expect(blockSpeech(block, true)).toBe('Bob Esponja, Ep. 1 · Titulo 1, 08:22–08:33, hoje');
  });
});
