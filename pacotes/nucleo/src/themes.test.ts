import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, mergeSettings, parseSettings, sanitizeSettings } from './settings';
import { applyTheme, THEME_PRESETS, touchesTheme } from './themes';
import type { LibraryWarning } from './types';

function parse(text: string) {
  const warnings: LibraryWarning[] = [];
  const settings = parseSettings('configuracoes.yaml', text, warnings);
  return { settings, warnings };
}

describe('themes', () => {
  it('the classic preset is the default look', () => {
    const classic = mergeSettings(DEFAULT_SETTINGS, applyTheme('classic'));
    expect(classic).toEqual(DEFAULT_SETTINGS);
    expect(DEFAULT_SETTINGS.theme).toBe('classic');
    expect(DEFAULT_SETTINGS.osdSkin).toBe('classic');
  });

  it('applies the preset values and the skin', () => {
    const modern = mergeSettings(DEFAULT_SETTINGS, applyTheme('modern'));
    expect(modern.theme).toBe('modern');
    expect(modern.osdSkin).toBe('modern');
    expect(modern.crt.enabled).toBe(false);
    expect(modern.aspect).toBe('original');
    expect(modern.channelChangeStatic).toBe(false);
    const vhs = mergeSettings(DEFAULT_SETTINGS, applyTheme('vhs'));
    expect(vhs.crt).toEqual(THEME_PRESETS.vhs.crt);
    expect(vhs.osdSkin).toBe('vhs');
  });

  it('"custom" only sets the label and keeps every value', () => {
    expect(applyTheme('custom')).toEqual({ theme: 'custom' });
    const settings = mergeSettings(mergeSettings(DEFAULT_SETTINGS, applyTheme('vhs')), applyTheme('custom'));
    expect(settings.theme).toBe('custom');
    expect(settings.osdSkin).toBe('vhs');
    expect(settings.crt.intensity).toBe('strong');
  });

  it('does not share the preset objects with the settings built from them', () => {
    const applied = applyTheme('vhs');
    applied.crt!.curvature = 99;
    expect(THEME_PRESETS.vhs.crt.curvature).toBe(15);
  });

  it('knows which changes leave a preset', () => {
    expect(touchesTheme({ crt: { curvature: 10 } })).toBe(true);
    expect(touchesTheme({ aspect: 'stretch' })).toBe(true);
    expect(touchesTheme({ channelChangeStatic: false })).toBe(true);
    expect(touchesTheme({ osdSkin: 'vhs' })).toBe(true);
    expect(touchesTheme({ clock: true })).toBe(false);
    expect(touchesTheme({ schedule: 'real', commercials: false })).toBe(false);
    expect(touchesTheme({ crt: {} })).toBe(false);
    expect(touchesTheme({ crt: { scanlines: undefined } })).toBe(false);
  });
});

describe('tema in configuracoes.yaml', () => {
  it('expands a theme to its preset', () => {
    const { settings, warnings } = parse('tema: vhs\n');
    expect(warnings).toEqual([]);
    expect(settings).toEqual(applyTheme('vhs'));
    expect(mergeSettings(DEFAULT_SETTINGS, settings).crt.intensity).toBe('strong');
  });

  it('reads every theme name', () => {
    expect(parse('tema: tv_antiga').settings.theme).toBe('classic');
    expect(parse('tema: TV_Moderna').settings.theme).toBe('modern');
    expect(parse('tema: personalizado').settings).toEqual({ theme: 'custom' });
  });

  it('lets explicit options win over the preset, in any order', () => {
    const before = parse('tema: tv_moderna\nproporcao: 4:3\ncrt:\n  ligado: sim\n  curvatura: 20\n').settings;
    const after = parse('crt:\n  ligado: sim\n  curvatura: 20\nproporcao: 4:3\ntema: tv_moderna\n').settings;
    expect(before).toEqual(after);
    const merged = mergeSettings(DEFAULT_SETTINGS, before);
    expect(merged.theme).toBe('modern');
    expect(merged.aspect).toBe('4:3');
    expect(merged.crt).toEqual({ enabled: true, intensity: 'soft', curvature: 20, scanlines: false });
    expect(merged.osdSkin).toBe('modern');
  });

  it('warns about an unknown theme and keeps the default', () => {
    const { settings, warnings } = parse('tema: neon\n');
    expect(settings).toEqual({});
    expect(warnings[0]!.message).toContain('"tema" deve ser tv_antiga, vhs, tv_moderna, personalizado');
  });

  it('sanitizes stored theme and skin', () => {
    expect(sanitizeSettings({ theme: 'vhs', osdSkin: 'modern' })).toEqual({ theme: 'vhs', osdSkin: 'modern' });
    expect(sanitizeSettings({ theme: 'neon', osdSkin: 3 })).toEqual({});
  });
});
