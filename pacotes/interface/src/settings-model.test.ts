import { DEFAULT_SETTINGS } from '@tv-gominho/nucleo';
import { describe, expect, it } from 'vitest';
import { buildDefs, CATEGORIES, watermarkSource } from './settings-model';

describe('watermark switch', () => {
  const item = buildDefs([], null).watermarkEnabled!;

  it('is on the picture page', () => {
    expect(CATEGORIES.find((category) => category.id === 'picture')!.rows).toContain('watermarkEnabled');
  });

  it('is on by default and writes the boolean', () => {
    expect(item.get(DEFAULT_SETTINGS)).toBe(true);
    expect(item.set(false)).toEqual({ watermarkEnabled: false });
  });

  it('is never locked: without a library watermark it switches the bundled logo', () => {
    expect(item.dimmed).toBeUndefined();
    expect(item.dimmedReason).toBeUndefined();
  });
});

describe('watermarkSource', () => {
  it('uses the bundled logo when the library sets none', () => {
    expect(watermarkSource(DEFAULT_SETTINGS)).toEqual({ kind: 'bundled' });
  });

  it('lets the library image win', () => {
    expect(watermarkSource({ watermark: 'imagens/marca.png', watermarkEnabled: true })).toEqual({ kind: 'library', path: 'imagens/marca.png' });
  });

  it('is off when the switch is off, with or without a library image', () => {
    expect(watermarkSource({ watermark: null, watermarkEnabled: false })).toEqual({ kind: 'off' });
    expect(watermarkSource({ watermark: 'marca.png', watermarkEnabled: false })).toEqual({ kind: 'off' });
  });
});
