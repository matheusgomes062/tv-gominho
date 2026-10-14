import { describe, expect, it } from 'vitest';
import { ProgressParser, lastError } from './run';

const block = (outTimeUs: number, speed = '2.5x', status = 'continue') =>
  `frame=100\nfps=50\nout_time_us=${outTimeUs}\nout_time_ms=${outTimeUs}\nout_time=00:00:05.000000\nspeed=${speed}\nprogress=${status}\n`;

describe('ProgressParser', () => {
  it('reports percentage and speed for each block', () => {
    const parser = new ProgressParser(20);
    const reports = parser.feed(block(5_000_000) + block(10_000_000));
    expect(reports).toEqual([
      { seconds: 5, percent: 25, speed: 2.5 },
      { seconds: 10, percent: 50, speed: 2.5 },
    ]);
  });

  it('handles lines split across chunks', () => {
    const parser = new ProgressParser(10);
    const text = block(2_000_000);
    expect(parser.feed(text.slice(0, 37))).toEqual([]);
    expect(parser.feed(text.slice(37))).toEqual([{ seconds: 2, percent: 20, speed: 2.5 }]);
  });

  it('caps overshoot and jumps to 100% on progress=end', () => {
    const parser = new ProgressParser(10);
    expect(parser.feed(block(10_500_000))[0]!.percent).toBe(100);
    expect(parser.feed(block(9_000_000, '1x', 'end'))[0]).toEqual({ seconds: 10, percent: 100, speed: 1 });
  });

  it('has no percentage when the duration is unknown, and ignores N/A times', () => {
    const parser = new ProgressParser(null);
    expect(parser.feed(block(3_000_000))[0]).toEqual({ seconds: 3, percent: null, speed: 2.5 });
    expect(parser.feed('out_time_us=N/A\nout_time_ms=N/A\nout_time=N/A\nspeed=N/A\nprogress=continue\n')).toEqual([]);
  });

  it('falls back to out_time and tolerates CRLF', () => {
    const parser = new ProgressParser(100);
    expect(parser.feed('out_time=00:01:05.500000\r\nspeed=N/A\r\nprogress=continue\r\n')).toEqual([
      { seconds: 65.5, percent: 65.5, speed: null },
    ]);
  });
});

describe('lastError', () => {
  it('returns the last non-empty line', () => {
    expect(lastError('a\n\nInvalid data found when processing input\n\n')).toBe('Invalid data found when processing input');
    expect(lastError('')).toMatch(/erro/);
  });
});
