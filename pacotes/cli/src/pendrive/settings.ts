// The settings of a pendrive job: the library's (configuracoes.yaml over the defaults) with the command-line
// flags on top, the same layering the app uses (docs/configuracoes.md). Pure, so it is tested without ffmpeg.

import { mergeSettings, type AspectMode, type CrtIntensity, type PartialSettings, type Settings } from '@tv-chuvisco/nucleo';
import { UsageError } from '../errors';
import { intOption } from '../options';
import { estimateBytes } from './parts';
import type { EncodeSettings } from './segment';

export const DEFAULT_DAYS = 5;
export const MAX_DAYS = 366;
export const DEFAULT_CRF = 22;
export const DEFAULT_PRESET = 'veryfast';
export const PRESETS = ['ultrafast', 'superfast', 'veryfast', 'faster', 'fast', 'medium', 'slow', 'slower', 'veryslow'];

const INTENSITIES: Record<string, CrtIntensity> = { suave: 'soft', media: 'medium', média: 'medium', forte: 'strong' };
const ASPECTS: Record<string, AspectMode> = { '4:3': '4:3', esticar: 'stretch', original: 'original' };

/** The flags that change the settings (parseArgs values). */
export interface SettingsFlags {
  'sem-crt'?: boolean;
  crt?: string;
  curvatura?: string;
  'sem-vinhetas'?: boolean;
  'sem-comerciais'?: boolean;
  'intervalo-a-cada'?: string;
  proporcao?: string;
}

/** The library's settings with the flags laid over them. Throws a UsageError for contradictory or invalid flags. */
export function applyFlags(base: Settings, flags: SettingsFlags): Settings {
  const override: PartialSettings = {};
  const crt: NonNullable<PartialSettings['crt']> = {};

  if (flags['sem-crt'] && (flags.crt !== undefined || flags.curvatura !== undefined)) {
    throw new UsageError('--sem-crt não combina com --crt nem com --curvatura.');
  }
  if (flags['sem-crt']) crt.enabled = false;
  if (flags.crt !== undefined) {
    const intensity = INTENSITIES[flags.crt.toLowerCase()];
    if (!intensity) throw new UsageError(`--crt "${flags.crt}" não existe. Use: suave, media ou forte.`);
    crt.intensity = intensity;
    crt.enabled = true;
  }
  const curvature = intOption('--curvatura', flags.curvatura, 0, 100);
  if (curvature !== undefined) {
    crt.curvature = curvature;
    crt.enabled = true;
  }
  if (Object.keys(crt).length > 0) override.crt = crt;

  if (flags['sem-vinhetas']) override.interstitials = false;
  if (flags['sem-comerciais']) override.commercials = false;
  const every = intOption('--intervalo-a-cada', flags['intervalo-a-cada'], 0, 30);
  if (every !== undefined) override.adBreaks = { every };
  if (flags.proporcao !== undefined) {
    const aspect = ASPECTS[flags.proporcao.toLowerCase()];
    if (!aspect) throw new UsageError(`--proporcao "${flags.proporcao}" não existe. Use: 4:3, esticar ou original.`);
    override.aspect = aspect;
  }
  return mergeSettings(base, override);
}

/** What the renderer needs from the settings. */
export function encodeSettings(settings: Settings, fps: number, crf: number, preset: string): EncodeSettings {
  return {
    fps,
    aspect: settings.aspect,
    crt: settings.crt.enabled
      ? { intensity: settings.crt.intensity, curvature: settings.crt.curvature, scanlines: settings.crt.scanlines }
      : null,
    crf,
    preset,
  };
}

/**
 * Rough average bitrate of the video (bits per second) for the dry run and the free-space check. Measured on
 * cartoons at the default quality; the CRT's grain and mask make the picture busier, so it costs more bits.
 * Real sizes are measured as the pieces are rendered, and the parts are split from those.
 */
export function estimatedVideoBitrate(encode: EncodeSettings): number {
  // Every step of CRF changes the size by about 12%.
  const crf = Math.pow(0.88, encode.crf - DEFAULT_CRF);
  const base = encode.crt ? 1_800_000 : 1_100_000;
  return Math.min(6_000_000, Math.round(base * crf));
}

/** Estimated size in bytes of `seconds` of rendered video. */
export function estimateSize(seconds: number, encode: EncodeSettings): number {
  return estimateBytes(seconds, estimatedVideoBitrate(encode));
}
