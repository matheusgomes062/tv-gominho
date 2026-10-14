// Themes (docs/configuracoes.md, `tema`). A theme is a PRESET of settings (CRT, aspect,
// channel-change static) plus an on-screen-display skin for the TV's own texts.
//
// The presets live here, as plain data, so that everything that needs them agrees:
// the YAML parser (`tema: vhs` expands to the preset values), the app's settings
// screen (picking a theme saves the preset as the user's choices) and the CLI.

import type { OsdSkin, PartialSettings, Theme } from './settings';

/** The themes with a preset. `custom` ("Personalizado") has none: it is "whatever the settings say". */
export type PresetTheme = Exclude<Theme, 'custom'>;

export const THEMES: readonly Theme[] = ['classic', 'vhs', 'modern', 'custom'];
export const OSD_SKINS: readonly OsdSkin[] = ['classic', 'vhs', 'modern'];

export const THEME_PRESETS: Record<PresetTheme, Required<Pick<PartialSettings, 'aspect' | 'channelChangeStatic' | 'osdSkin'>> & { crt: Required<NonNullable<PartialSettings['crt']>> }> = {
  // The original look: medium tube, curved, scanlines, 4:3 with snow between channels.
  classic: {
    crt: { enabled: true, intensity: 'medium', curvature: 50, scanlines: true },
    aspect: '4:3',
    channelChangeStatic: true,
    osdSkin: 'classic',
  },
  // A tape on a tired VCR: stronger, flatter tube, still 4:3 with snow.
  vhs: {
    crt: { enabled: true, intensity: 'strong', curvature: 15, scanlines: true },
    aspect: '4:3',
    channelChangeStatic: true,
    osdSkin: 'vhs',
  },
  // A flat modern screen: no tube, the video's own shape, no snow (a black screen between channels).
  modern: {
    crt: { enabled: false, intensity: 'soft', curvature: 0, scanlines: false },
    aspect: 'original',
    channelChangeStatic: false,
    osdSkin: 'modern',
  },
};

/**
 * The settings a theme sets, as a `PartialSettings` (including `theme` itself).
 * `custom` sets only the label: it keeps every value the user has now.
 */
export function applyTheme(theme: Theme): PartialSettings {
  if (theme === 'custom') return { theme };
  const preset = THEME_PRESETS[theme];
  return { ...preset, crt: { ...preset.crt }, theme };
}

/** True when `partial` changes something a preset covers (so the theme is no longer exactly the preset). */
export function touchesTheme(partial: PartialSettings): boolean {
  if (partial.aspect !== undefined || partial.channelChangeStatic !== undefined || partial.osdSkin !== undefined) return true;
  return partial.crt !== undefined && Object.values(partial.crt).some((value) => value !== undefined);
}
