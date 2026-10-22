import { describe, expect, it } from 'vitest';
import { channelSummary, pairingBadge, resolveHubTarget, sameHubTarget, shortDays } from './hub-model';

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

describe('channel rows', () => {
  const at = (hours: number) => hours * 3600;
  const show = (id: string) => ({ type: 'show' as const, show: id, count: 1 });

  it('names the days in few words', () => {
    expect(shortDays(['seg', 'ter', 'qua', 'qui', 'sex'])).toBe('Seg a sex');
    expect(shortDays(['dom', 'sab'])).toBe('Sáb e dom');
    expect(shortDays(['sex', 'seg', 'qua'])).toBe('Seg, qua e sex');
    expect(shortDays(['seg', 'ter', 'qua', 'sab'])).toBe('Seg a qua e sáb');
    expect(shortDays(['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sab'])).toBe('Todos os dias');
    expect(shortDays(['qua'])).toBe('Qua');
    expect(shortDays([])).toBe('Nenhum dia');
  });

  it('sums a channel up: days, first to last block, distinct shows', () => {
    const days = ['seg', 'ter', 'qua', 'qui', 'sex'] as const;
    const blocks = [
      { start: at(8), items: [show('dbz'), { type: 'commercials' as const, count: 2 }, show('pinguins'), show('dbz')] },
      { start: at(14), items: [show('tom'), show('jerry')] },
    ];
    expect(channelSummary({ days: [...days], blocks })).toBe('Seg a sex · 08:00–14:00 · 4 desenhos');
    expect(channelSummary({ days: [...days], blocks: [blocks[0]!] })).toBe('Seg a sex · 08:00 · 2 desenhos');
    expect(channelSummary({ days: ['sab'], blocks: [{ start: at(9), items: [show('dbz')] }] })).toBe('Sáb · 09:00 · 1 desenho');
    expect(channelSummary({ days: ['sab'], blocks: [] })).toBe('Sáb · sem horários · sem desenhos');
  });
});

describe('pairing badge', () => {
  it('shows nothing unless the library is served with --editar and the state is known', () => {
    expect(pairingBadge(false, true)).toBeNull();
    expect(pairingBadge(true, null)).toBeNull();
  });

  it('says paired or that the PIN is missing', () => {
    expect(pairingBadge(true, true)).toEqual({ label: 'Pareado', ok: true });
    expect(pairingBadge(true, false)).toEqual({ label: 'Falta o PIN', ok: false });
  });
});
