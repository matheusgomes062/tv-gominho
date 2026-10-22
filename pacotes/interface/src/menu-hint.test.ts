import { describe, expect, it } from 'vitest';
import { hintSeen, markHintSeen } from './menu-hint';

function fakeStore() {
  const data = new Map<string, string>();
  return { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => void data.set(key, value) };
}

describe('menu hint memory', () => {
  it('is new until it was marked', () => {
    const store = fakeStore();
    expect(hintSeen(store)).toBe(false);
    markHintSeen(store);
    expect(hintSeen(store)).toBe(true);
  });

  it('survives blocked storage', () => {
    const broken = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    };
    expect(hintSeen(broken)).toBe(false);
    expect(() => markHintSeen(broken)).not.toThrow();
    expect(hintSeen(null)).toBe(false);
  });
});
