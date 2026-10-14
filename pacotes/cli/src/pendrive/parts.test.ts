import { describe, expect, it } from 'vitest';
import { PART_TARGET_BYTES, cutRank, estimateBytes, splitParts, type CutInfo } from './parts';

const GB = 1_000_000_000;
const item = (): CutInfo => ({ inBreak: false });
const ad = (): CutInfo => ({ inBreak: true });

describe('cutRank', () => {
  it('prefers the end of a commercial break, then between items, then before a break, and never between two ads', () => {
    expect(cutRank(ad(), item())).toBe(1);
    expect(cutRank(item(), item())).toBe(2);
    expect(cutRank(item(), ad())).toBe(3);
    expect(cutRank(ad(), ad())).toBe(4);
  });
});

describe('splitParts', () => {
  it('keeps a day that fits in one part', () => {
    expect(splitParts([item(), ad(), ad()], [1 * GB, 1 * GB, 1 * GB])).toEqual([{ start: 0, end: 3, bytes: 3 * GB, oversize: false }]);
  });

  it('never exceeds the cap and covers every piece exactly once, in order', () => {
    const pieces: CutInfo[] = [];
    const sizes: number[] = [];
    for (let i = 0; i < 40; i++) {
      pieces.push(item(), ad(), ad(), ad());
      sizes.push(700_000_000, 20_000_000, 25_000_000, 15_000_000);
    }
    const parts = splitParts(pieces, sizes);
    expect(parts.length).toBeGreaterThan(1);
    expect(parts[0]!.start).toBe(0);
    for (let i = 0; i < parts.length; i++) {
      expect(parts[i]!.bytes).toBeLessThanOrEqual(PART_TARGET_BYTES);
      expect(parts[i]!.end).toBeGreaterThan(parts[i]!.start);
      if (i > 0) expect(parts[i]!.start).toBe(parts[i - 1]!.end);
    }
    expect(parts.at(-1)!.end).toBe(pieces.length);
    expect(parts.reduce((sum, part) => sum + part.bytes, 0)).toBe(sizes.reduce((sum, size) => sum + size, 0));
  });

  it('closes a part right after a commercial break when it can, never inside one', () => {
    const pieces: CutInfo[] = [];
    const sizes: number[] = [];
    for (let i = 0; i < 12; i++) {
      pieces.push(item(), ad(), ad(), ad());
      sizes.push(600_000_000, 30_000_000, 30_000_000, 30_000_000);
    }
    const parts = splitParts(pieces, sizes);
    for (const part of parts.slice(0, -1)) {
      // The piece before the cut is a commercial and the one after it is the show again.
      expect(pieces[part.end - 1]!.inBreak).toBe(true);
      expect(pieces[part.end]!.inBreak).toBe(false);
    }
  });

  it('uses the latest good cut that leaves the part at least half full', () => {
    // 1 GB item, break, 1 GB item, break, 1.5 GB item: the third does not fit with the first two (3.5 GB cap).
    const pieces = [item(), ad(), item(), ad(), item(), ad()];
    const sizes = [1 * GB, 0.1 * GB, 1 * GB, 0.1 * GB, 1.5 * GB, 0.1 * GB];
    const parts = splitParts(pieces, sizes);
    expect(parts.map((part) => [part.start, part.end])).toEqual([
      [0, 4],
      [4, 6],
    ]);
  });

  it('falls back to a cut between items, then before a break, and only last between two ads', () => {
    // No commercial breaks at all: cut between items.
    expect(splitParts([item(), item(), item()], [2 * GB, 2 * GB, 2 * GB]).map((part) => [part.start, part.end])).toEqual([
      [0, 1],
      [1, 2],
      [2, 3],
    ]);
    // An act followed by a break that is just too big to fit with it: cut before the break (rank 3).
    const parts = splitParts([item(), ad(), ad()], [3.4 * GB, 0.2 * GB, 0.2 * GB]);
    expect(parts.map((part) => [part.start, part.end])).toEqual([
      [0, 1],
      [1, 3],
    ]);
    // Only ads: between two of them, as a last resort.
    expect(splitParts([ad(), ad(), ad()], [2 * GB, 2 * GB, 2 * GB]).length).toBe(3);
  });

  it('flags a single video bigger than the cap as oversize instead of cutting it', () => {
    const parts = splitParts([item(), item()], [4.5 * GB, 1 * GB]);
    expect(parts).toEqual([
      { start: 0, end: 1, bytes: 4.5 * GB, oversize: true },
      { start: 1, end: 2, bytes: 1 * GB, oversize: false },
    ]);
  });

  it('works with a tiny cap and with no pieces', () => {
    expect(splitParts([], [])).toEqual([]);
    expect(splitParts([item(), ad(), item()], [10, 10, 10], 25).map((part) => [part.start, part.end])).toEqual([
      [0, 2],
      [2, 3],
    ]);
  });
});

describe('estimateBytes', () => {
  it('turns seconds and a video bitrate into bytes, counting the audio', () => {
    // 1000 s at (1 Mb/s + 160 kb/s) = 145 MB, plus 1% overhead.
    expect(estimateBytes(1000, 1_000_000)).toBe(Math.round(145_000_000 * 1.01));
    expect(estimateBytes(0, 1_000_000)).toBe(0);
  });
});
