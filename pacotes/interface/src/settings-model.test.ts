import { DEFAULT_SETTINGS } from '@tv-gominho/nucleo';
import { describe, expect, it } from 'vitest';
import { buildDefs, CATEGORIES } from './settings-model';

describe('watermark switch', () => {
  const item = buildDefs([], null).watermarkEnabled!;

  it('is on the picture page', () => {
    expect(CATEGORIES.find((category) => category.id === 'picture')!.rows).toContain('watermarkEnabled');
  });

  it('is on by default and writes the boolean', () => {
    expect(item.get(DEFAULT_SETTINGS)).toBe(true);
    expect(item.set(false)).toEqual({ watermarkEnabled: false });
  });

  it('is locked, with a reason, while the library has no watermark', () => {
    expect(item.dimmed?.(DEFAULT_SETTINGS)).toBe(true);
    expect(item.dimmed?.({ ...DEFAULT_SETTINGS, watermark: 'imagens/marca.png' })).toBe(false);
    expect(item.dimmedReason).toBeTruthy();
  });
});
