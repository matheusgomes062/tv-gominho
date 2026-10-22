import { describe, expect, it } from 'vitest';
import { resolveHubTarget, sameHubTarget } from './hub-model';

describe('hub focus target', () => {
  it('starts on the first row', () => {
    expect(resolveHubTarget(null, [])).toEqual({ kind: 'wizard' });
  });

  it('returns to the row the sub-screen was opened from', () => {
    expect(resolveHubTarget({ kind: 'blocklist' }, [])).toEqual({ kind: 'blocklist' });
    expect(resolveHubTarget({ kind: 'edit', id: 'manhas' }, ['tarde', 'manhas'])).toEqual({ kind: 'edit', id: 'manhas' });
  });

  it('falls back to the first row when the edited channel is gone', () => {
    expect(resolveHubTarget({ kind: 'edit', id: 'manhas' }, ['tarde'])).toEqual({ kind: 'wizard' });
  });

  it('compares targets, with the channel for edits', () => {
    expect(sameHubTarget({ kind: 'edit', id: 'a' }, { kind: 'edit', id: 'a' })).toBe(true);
    expect(sameHubTarget({ kind: 'edit', id: 'a' }, { kind: 'edit', id: 'b' })).toBe(false);
    expect(sameHubTarget({ kind: 'wizard' }, { kind: 'blocklist' })).toBe(false);
  });
});
