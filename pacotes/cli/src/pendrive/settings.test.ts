import { DEFAULT_SETTINGS, mergeSettings } from '@tv-gominho/nucleo';
import { describe, expect, it } from 'vitest';
import { applyFlags, encodeSettings, estimateSize, estimatedVideoBitrate } from './settings';

describe('applyFlags', () => {
  it('leaves the library settings alone without flags', () => {
    expect(applyFlags(DEFAULT_SETTINGS, {})).toEqual(DEFAULT_SETTINGS);
    const library = mergeSettings(DEFAULT_SETTINGS, { crt: { intensity: 'strong' }, commercials: false, aspect: 'stretch' });
    expect(applyFlags(library, {})).toEqual(library);
  });

  it('lets the flags win over the library', () => {
    const library = mergeSettings(DEFAULT_SETTINGS, { crt: { intensity: 'strong', curvature: 20 }, commercials: false, interstitials: false });
    const settings = applyFlags(library, { crt: 'suave', curvatura: '80', 'intervalo-a-cada': '10', proporcao: 'esticar' });
    expect(settings.crt).toMatchObject({ enabled: true, intensity: 'soft', curvature: 80 });
    expect(settings.adBreaks.every).toBe(10);
    expect(settings.aspect).toBe('stretch');
    // Not mentioned: stays as the library says.
    expect(settings.commercials).toBe(false);
    expect(settings.interstitials).toBe(false);
  });

  it('turns things off', () => {
    const settings = applyFlags(DEFAULT_SETTINGS, { 'sem-crt': true, 'sem-vinhetas': true, 'sem-comerciais': true });
    expect(settings.crt.enabled).toBe(false);
    expect(settings.interstitials).toBe(false);
    expect(settings.commercials).toBe(false);
  });

  it('turns the CRT on when asked for an intensity or a curvature, even if the library has it off', () => {
    const off = mergeSettings(DEFAULT_SETTINGS, { crt: { enabled: false } });
    expect(applyFlags(off, { crt: 'forte' }).crt).toMatchObject({ enabled: true, intensity: 'strong' });
    expect(applyFlags(off, { curvatura: '0' }).crt).toMatchObject({ enabled: true, curvature: 0 });
  });

  it('accepts every intensity name and aspect', () => {
    expect(applyFlags(DEFAULT_SETTINGS, { crt: 'media' }).crt.intensity).toBe('medium');
    expect(applyFlags(DEFAULT_SETTINGS, { crt: 'FORTE' }).crt.intensity).toBe('strong');
    expect(applyFlags(DEFAULT_SETTINGS, { proporcao: '4:3' }).aspect).toBe('4:3');
    expect(applyFlags(DEFAULT_SETTINGS, { proporcao: 'original' }).aspect).toBe('original');
  });

  it('refuses nonsense in pt-BR', () => {
    expect(() => applyFlags(DEFAULT_SETTINGS, { crt: 'enorme' })).toThrow(/suave, media ou forte/);
    expect(() => applyFlags(DEFAULT_SETTINGS, { curvatura: '101' })).toThrow(/0 a 100/);
    expect(() => applyFlags(DEFAULT_SETTINGS, { curvatura: 'muita' })).toThrow(/número inteiro/);
    expect(() => applyFlags(DEFAULT_SETTINGS, { 'intervalo-a-cada': '31' })).toThrow(/0 a 30/);
    expect(() => applyFlags(DEFAULT_SETTINGS, { proporcao: '16:9' })).toThrow(/4:3, esticar ou original/);
    expect(() => applyFlags(DEFAULT_SETTINGS, { 'sem-crt': true, crt: 'suave' })).toThrow(/não combina/);
  });
});

describe('encodeSettings', () => {
  it('has no CRT when it is off, and the look when it is on', () => {
    expect(encodeSettings(applyFlags(DEFAULT_SETTINGS, { 'sem-crt': true }), 30, 22, 'veryfast').crt).toBeNull();
    expect(encodeSettings(DEFAULT_SETTINGS, 25, 20, 'slow')).toEqual({
      fps: 25,
      aspect: '4:3',
      crt: { intensity: 'medium', curvature: 50, scanlines: true },
      crf: 20,
      preset: 'slow',
    });
  });

  it('follows what a theme sets: the modern theme is a flat screen in the original shape', () => {
    const modern = mergeSettings(DEFAULT_SETTINGS, { crt: { enabled: false }, aspect: 'original' });
    const encode = encodeSettings(modern, 30, 22, 'veryfast');
    expect(encode.crt).toBeNull();
    expect(encode.aspect).toBe('original');
  });
});

describe('size estimate', () => {
  const encode = encodeSettings(DEFAULT_SETTINGS, 30, 22, 'veryfast');

  it('grows with the time and shrinks with a worse quality', () => {
    expect(estimateSize(7200, encode)).toBeGreaterThan(estimateSize(3600, encode));
    expect(estimatedVideoBitrate({ ...encode, crf: 28 })).toBeLessThan(estimatedVideoBitrate(encode));
    expect(estimatedVideoBitrate({ ...encode, crf: 16 })).toBeGreaterThan(estimatedVideoBitrate(encode));
  });

  it('is cheaper without the CRT (grain and mask cost bits)', () => {
    expect(estimatedVideoBitrate({ ...encode, crt: null })).toBeLessThan(estimatedVideoBitrate(encode));
  });

  it('never goes above the encoder cap', () => {
    expect(estimatedVideoBitrate({ ...encode, crf: 0 })).toBeLessThanOrEqual(6_000_000);
  });
});
