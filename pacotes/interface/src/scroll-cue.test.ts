import { describe, expect, it } from 'vitest';
import { moreBelow } from './scroll-cue';

describe('more below', () => {
  it('is true while content lies below the visible part', () => {
    expect(moreBelow({ scrollTop: 0, clientHeight: 400, scrollHeight: 900 })).toBe(true);
    expect(moreBelow({ scrollTop: 200, clientHeight: 400, scrollHeight: 900 })).toBe(true);
  });

  it('is false at the end, or when everything fits', () => {
    expect(moreBelow({ scrollTop: 500, clientHeight: 400, scrollHeight: 900 })).toBe(false);
    expect(moreBelow({ scrollTop: 0, clientHeight: 400, scrollHeight: 400 })).toBe(false);
    expect(moreBelow({ scrollTop: 0, clientHeight: 400, scrollHeight: 300 })).toBe(false);
  });

  it('ignores a few pixels from the end, and a box that is not drawn', () => {
    expect(moreBelow({ scrollTop: 497, clientHeight: 400, scrollHeight: 900 })).toBe(false);
    expect(moreBelow({ scrollTop: 0, clientHeight: 0, scrollHeight: 900 })).toBe(false);
  });
});
