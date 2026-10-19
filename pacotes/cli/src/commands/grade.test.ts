import { describe, expect, it } from 'vitest';
import { parseBlocks } from './grade';

describe('parseBlocks', () => {
  it('reads start-end pairs, sorted', () => {
    expect(parseBlocks('10:30-12:00, 08:00-10:00')).toEqual([
      { start: 8 * 3600, length: 2 * 3600 },
      { start: 10.5 * 3600, length: 1.5 * 3600 },
    ]);
  });

  it('lets a block pass midnight', () => {
    expect(parseBlocks('23:00-01:00')).toEqual([{ start: 23 * 3600, length: 2 * 3600 }]);
  });

  it.each(['', '08:00', '08:00-08:00', '8h-10h', '08:00-10:00-11:00', '08:00-10:00,09:00-11:00'])('refuses "%s"', (text) => {
    expect(() => parseBlocks(text)).toThrow();
  });
});
