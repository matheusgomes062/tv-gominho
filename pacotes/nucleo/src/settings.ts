// User settings (docs/configuracoes.md). Layers, from weakest to strongest:
//   DEFAULT_SETTINGS < biblioteca/configuracoes.yaml < choices made in the app menu.
// The file and the menu only hold what differs from the layer below, as a
// `PartialSettings`; `mergeSettings` stacks them into a complete `Settings`.

import { parse } from 'yaml';
import { fold } from './paths';
import { applyTheme } from './themes';
import type { LibraryWarning, Schedule } from './types';

/** 'continuous': the day's schedule loops 24h. 'real': follows the wall clock. 'fromStart': always begins at the first block. */
export type ScheduleMode = 'continuous' | 'real' | 'fromStart';
export type CrtIntensity = 'soft' | 'medium' | 'strong';
/** '4:3': pillarboxed 4:3 frame. 'stretch': fill the screen. 'original': the video's own shape, contained. */
export type AspectMode = '4:3' | 'stretch' | 'original';
export type StartMode = 'tv' | 'library';
/**
 * 'classic' (TV antiga), 'vhs' (Fita VHS) and 'modern' (TV moderna) are presets (see themes.ts);
 * 'custom' (Personalizado) means "the settings were changed by hand after picking a theme".
 */
export type Theme = 'classic' | 'vhs' | 'modern' | 'custom';
/** The look of the TV's own on-screen display (channel number, info bar, clock). */
export type OsdSkin = 'classic' | 'vhs' | 'modern';

export interface CrtSettings {
  enabled: boolean;
  intensity: CrtIntensity;
  /** Screen curvature in percent: 0 = flat, 100 = strongly bulged. Independent of `intensity`. */
  curvature: number;
  scanlines: boolean;
}

/** Commercial breaks (docs/configuracoes.md, `intervalos`). Only play when `commercials` is on. */
export interface AdBreakSettings {
  /** Minutes of episode between breaks; 0 = no breaks in the middle of episodes. */
  every: number;
  /** Commercials per break. */
  ads: number;
  /** A break after every episode. */
  afterEpisode: boolean;
  /** Bumpers going into and coming back from each break (vinhetas/intervalos/). Also need `interstitials`. */
  bumpers: boolean;
}

export const AD_BREAK_LIMITS = { every: { min: 0, max: 30 }, ads: { min: 1, max: 10 } } as const;

export interface Settings {
  startMode: StartMode;
  /** Name or file id of the schedule to open when no channel was saved; null = the first one. */
  startChannel: string | null;
  /** One extra channel per show (docs/configuracoes.md). */
  channelsPerShow: boolean;
  schedule: ScheduleMode;
  crt: CrtSettings;
  /** Show static when changing channels (otherwise a black screen). */
  channelChangeStatic: boolean;
  aspect: AspectMode;
  /** Play bumpers (vinhetas/), including the ones that fill gaps. */
  interstitials: boolean;
  /** Play commercials (vinhetas/comerciais/), including the ones that fill gaps. */
  commercials: boolean;
  /** When the commercial breaks come (needs `commercials`). */
  adBreaks: AdBreakSettings;
  /** Small HH:MM clock on the TV screen. */
  clock: boolean;
  /** The theme chosen (docs/configuracoes.md, `tema`). The preset's values are ordinary settings; this is the label. */
  theme: Theme;
  /** The OSD skin. A theme sets it; with 'custom' it stays whatever it was. Not a yaml option on its own. */
  osdSkin: OsdSkin;
  // TODO(phase 2): `marca_dagua` (watermark image) and `idioma`.
}

export type PartialSettings = Partial<Omit<Settings, 'crt' | 'adBreaks'>> & {
  crt?: Partial<CrtSettings>;
  adBreaks?: Partial<AdBreakSettings>;
};

export const DEFAULT_AD_BREAKS: AdBreakSettings = { every: 8, ads: 3, afterEpisode: true, bumpers: true };

/** Curvature percent that matches the original fixed 'medium' look. */
export const DEFAULT_CURVATURE = 50;

export const DEFAULT_SETTINGS: Settings = {
  startMode: 'tv',
  startChannel: null,
  channelsPerShow: true,
  schedule: 'continuous',
  crt: { enabled: true, intensity: 'medium', curvature: DEFAULT_CURVATURE, scanlines: true },
  channelChangeStatic: true,
  aspect: '4:3',
  interstitials: true,
  commercials: true,
  adBreaks: DEFAULT_AD_BREAKS,
  clock: false,
  theme: 'classic',
  osdSkin: 'classic',
};

/** Layers `partial` on top of `base`; fields missing from `partial` keep the base value. */
export function mergeSettings(base: Settings, partial: PartialSettings | undefined): Settings {
  if (!partial) return base;
  const { crt, adBreaks, ...rest } = partial;
  const merged: Settings = {
    ...base,
    ...definedOnly(rest),
    crt: { ...base.crt, ...definedOnly(crt) },
    adBreaks: { ...base.adBreaks, ...definedOnly(adBreaks) },
  };
  return merged;
}

function definedOnly<T extends object>(value: T | undefined): Partial<T> {
  return Object.fromEntries(Object.entries(value ?? {}).filter(([, entry]) => entry !== undefined)) as Partial<T>;
}

const ALLOWED = {
  startMode: ['tv', 'library'],
  schedule: ['continuous', 'real', 'fromStart'],
  aspect: ['4:3', 'stretch', 'original'],
  theme: ['classic', 'vhs', 'modern', 'custom'],
  osdSkin: ['classic', 'vhs', 'modern'],
  intensity: ['soft', 'medium', 'strong'],
} as const;

/**
 * Cleans a `PartialSettings` that came from outside (e.g. the browser's
 * storage): keeps known fields with valid values, drops everything else.
 */
export function sanitizeSettings(value: unknown): PartialSettings {
  if (!isRecord(value)) return {};
  const result: PartialSettings = {};
  const flag = (source: Record<string, unknown>, key: string) =>
    typeof source[key] === 'boolean' ? (source[key] as boolean) : undefined;
  const option = <T extends string>(source: Record<string, unknown>, key: string, allowed: readonly T[]) =>
    allowed.find((entry) => entry === source[key]);

  result.startMode = option(value, 'startMode', ALLOWED.startMode);
  result.schedule = option(value, 'schedule', ALLOWED.schedule);
  result.aspect = option(value, 'aspect', ALLOWED.aspect);
  result.channelsPerShow = flag(value, 'channelsPerShow');
  result.channelChangeStatic = flag(value, 'channelChangeStatic');
  result.interstitials = flag(value, 'interstitials');
  result.commercials = flag(value, 'commercials');
  result.clock = flag(value, 'clock');
  result.theme = option(value, 'theme', ALLOWED.theme);
  result.osdSkin = option(value, 'osdSkin', ALLOWED.osdSkin);
  if (value.startChannel === null || typeof value.startChannel === 'string') result.startChannel = value.startChannel;
  if (isRecord(value.crt)) {
    result.crt = definedOnly({
      enabled: flag(value.crt, 'enabled'),
      intensity: option(value.crt, 'intensity', ALLOWED.intensity),
      curvature: curvatureFromStorage(value.crt.curvature),
      scanlines: flag(value.crt, 'scanlines'),
    });
  }
  if (isRecord(value.adBreaks)) {
    result.adBreaks = definedOnly({
      every: clampedNumber(value.adBreaks.every, AD_BREAK_LIMITS.every),
      ads: clampedNumber(value.adBreaks.ads, AD_BREAK_LIMITS.ads),
      afterEpisode: flag(value.adBreaks, 'afterEpisode'),
      bumpers: flag(value.adBreaks, 'bumpers'),
    });
  }
  return definedOnly(result);
}

function clampedNumber(value: unknown, limits: { min: number; max: number }): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  return Math.round(Math.min(limits.max, Math.max(limits.min, value)));
}

const THEME_NAMES: Record<string, Theme> = { tv_antiga: 'classic', vhs: 'vhs', tv_moderna: 'modern', personalizado: 'custom' };

const UNSUPPORTED_YET = new Set(['marca_dagua', 'idioma']);

/**
 * Parses a configuracoes.yaml. Returns only what the file sets (valid values);
 * unknown keys and bad values become pt-BR warnings and are left out, so the
 * layer below applies. Use `mergeSettings(DEFAULT_SETTINGS, result)`.
 */
export function parseSettings(path: string, text: string, warnings: LibraryWarning[]): PartialSettings {
  const warn = (message: string) => warnings.push({ path, message });

  let raw: unknown;
  try {
    raw = parse(text);
  } catch (error) {
    warn(`Erro de sintaxe no arquivo de configurações: ${(error as Error).message}`);
    return {};
  }
  if (raw === null || raw === undefined) return {};
  if (!isRecord(raw)) {
    warn('O arquivo de configurações deve ser uma lista de opções, por exemplo "horario: real".');
    return {};
  }

  const result: PartialSettings = {};
  let themeFromFile: Theme | undefined;
  const set = <K extends keyof Omit<Settings, 'crt' | 'adBreaks'>>(key: K, value: Settings[K] | undefined) => {
    if (value !== undefined) result[key] = value;
  };

  for (const [key, value] of Object.entries(raw)) {
    switch (key) {
      case 'modo_inicial':
        set('startMode', choice(key, value, { tv: 'tv', biblioteca: 'library' }, warn));
        break;
      case 'canal_inicial':
        if (typeof value === 'string' && value.trim()) set('startChannel', value.trim());
        else if (value !== null) warn('"canal_inicial" deve ser o nome de uma grade, por exemplo "TV Globinho".');
        break;
      case 'canais_por_programa':
        set('channelsPerShow', bool(key, value, warn));
        break;
      case 'horario':
        set('schedule', choice(key, value, { continuo: 'continuous', real: 'real', do_inicio: 'fromStart' }, warn));
        break;
      case 'chuvisco_troca_canal':
        set('channelChangeStatic', bool(key, value, warn));
        break;
      case 'proporcao':
        set('aspect', choice(key, value, { '4:3': '4:3', esticar: 'stretch', original: 'original' }, warn));
        break;
      case 'vinhetas':
        set('interstitials', bool(key, value, warn));
        break;
      case 'comerciais':
        set('commercials', bool(key, value, warn));
        break;
      case 'intervalos': {
        const adBreaks = parseAdBreaks(value, warn);
        if (Object.keys(adBreaks).length > 0) result.adBreaks = adBreaks;
        break;
      }
      case 'tema': {
        const theme = choice(key, value, THEME_NAMES, warn);
        if (theme !== undefined) themeFromFile = theme;
        break;
      }
      case 'relogio_na_tela':
        set('clock', bool(key, value, warn));
        break;
      case 'crt': {
        const crt = parseCrt(value, warn);
        if (Object.keys(crt).length > 0) result.crt = crt;
        break;
      }
      default:
        if (UNSUPPORTED_YET.has(key)) warn(`A opção "${key}" ainda não é suportada nesta versão e foi ignorada.`);
        else warn(`Opção desconhecida: "${key}". Ela foi ignorada.`);
    }
  }
  if (themeFromFile === undefined) return result;
  // `tema` expands to its preset; anything else the file sets explicitly wins over the preset, whatever the order.
  const preset = applyTheme(themeFromFile);
  const crt = { ...preset.crt, ...result.crt };
  return { ...preset, ...result, ...(Object.keys(crt).length > 0 ? { crt } : {}), theme: themeFromFile };
}

function parseAdBreaks(value: unknown, warn: (message: string) => void): Partial<AdBreakSettings> {
  const adBreaks: Partial<AdBreakSettings> = {};
  if (value === null || value === undefined) return adBreaks;
  if (!isRecord(value)) {
    warn('"intervalos" deve ter opções por baixo, por exemplo "intervalos:" e, indentado, "a_cada: 8".');
    return adBreaks;
  }
  for (const [key, entry] of Object.entries(value)) {
    const label = `intervalos.${key}`;
    if (key === 'a_cada') adBreaks.every = count(label, entry, AD_BREAK_LIMITS.every, 'minutos (0 = sem intervalo no meio do episódio)', warn);
    else if (key === 'comerciais') adBreaks.ads = count(label, entry, AD_BREAK_LIMITS.ads, 'comerciais por intervalo', warn);
    else if (key === 'apos_episodio') adBreaks.afterEpisode = bool(label, entry, warn);
    else if (key === 'vinhetas') adBreaks.bumpers = bool(label, entry, warn);
    else warn(`Opção desconhecida: "${label}". Ela foi ignorada.`);
  }
  return definedOnly(adBreaks);
}

/** A whole number within `limits` (a number, or text like "8" / "8 min"); outside the limits it is clamped, with a warning. */
function count(
  key: string,
  value: unknown,
  limits: { min: number; max: number },
  unit: string,
  warn: (message: string) => void,
): number | undefined {
  let amount: number | undefined;
  if (typeof value === 'number' && Number.isFinite(value)) amount = value;
  else if (typeof value === 'string') {
    const match = /^(\d+(?:[.,]\d+)?)\s*(?:min\w*)?$/.exec(fold(value.trim()));
    if (match) amount = Number(match[1]!.replace(',', '.'));
  }
  if (amount === undefined) {
    warn(`"${key}" deve ser um número de ${limits.min} a ${limits.max} (${unit}), recebi ${show(value)}. Usando o padrão.`);
    return undefined;
  }
  const result = Math.round(Math.min(limits.max, Math.max(limits.min, amount)));
  if (amount < limits.min || amount > limits.max) {
    warn(`"${key}" deve ficar entre ${limits.min} e ${limits.max} (recebi ${show(value)}). Usei ${result}.`);
  }
  return result;
}

function parseCrt(value: unknown, warn: (message: string) => void): Partial<CrtSettings> {
  const crt: Partial<CrtSettings> = {};
  if (value === null || value === undefined) return crt;
  if (!isRecord(value)) {
    warn('"crt" deve ter opções por baixo, por exemplo "crt:" e, indentado, "intensidade: suave".');
    return crt;
  }
  for (const [key, entry] of Object.entries(value)) {
    const label = `crt.${key}`;
    if (key === 'ligado') crt.enabled = bool(label, entry, warn);
    else if (key === 'curvatura') crt.curvature = curvature(label, entry, warn);
    else if (key === 'linhas') crt.scanlines = bool(label, entry, warn);
    else if (key === 'intensidade') {
      crt.intensity = choice(label, entry, { suave: 'soft', media: 'medium', forte: 'strong' }, warn);
    } else warn(`Opção desconhecida: "${label}". Ela foi ignorada.`);
  }
  return definedOnly(crt);
}

/**
 * Curvature from the yaml: a number 0-100 (or "50%"), or the old sim (= default) / não (= 0).
 * Numbers outside 0-100 are clamped, with a warning.
 */
function curvature(key: string, value: unknown, warn: (message: string) => void): number | undefined {
  let amount: number | undefined;
  if (typeof value === 'number' && Number.isFinite(value)) amount = value;
  else if (typeof value === 'boolean') return value ? DEFAULT_CURVATURE : 0;
  else if (typeof value === 'string') {
    const text = fold(value.trim());
    if (text === 'sim' || text === 'true') return DEFAULT_CURVATURE;
    if (text === 'nao' || text === 'false') return 0;
    const match = /^(\d+(?:[.,]\d+)?)\s*%?$/.exec(text);
    if (match) amount = Number(match[1]!.replace(',', '.'));
  }
  if (amount === undefined) {
    warn(`"${key}" deve ser um número de 0 a 100 (ou sim/não), recebi ${show(value)}. Usando o padrão.`);
    return undefined;
  }
  if (amount < 0 || amount > 100) {
    warn(`"${key}" deve ficar entre 0 e 100 (recebi ${show(value)}). Usei ${amount < 0 ? 0 : 100}.`);
  }
  return Math.round(Math.min(100, Math.max(0, amount)));
}

/** Old stored overrides were booleans: true = default amount, false = flat. */
function curvatureFromStorage(value: unknown): number | undefined {
  if (typeof value === 'boolean') return value ? DEFAULT_CURVATURE : 0;
  if (typeof value === 'number' && Number.isFinite(value)) return Math.round(Math.min(100, Math.max(0, value)));
  return undefined;
}

function bool(key: string, value: unknown, warn: (message: string) => void): boolean | undefined {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const text = fold(value.trim());
    if (text === 'sim' || text === 'true') return true;
    if (text === 'nao' || text === 'false') return false;
  }
  warn(`"${key}" deve ser sim ou não (recebi ${show(value)}). Usando o padrão.`);
  return undefined;
}

function choice<T>(
  key: string,
  value: unknown,
  options: Record<string, T>,
  warn: (message: string) => void,
): T | undefined {
  const text = fold(String(value ?? '').trim());
  if (Object.hasOwn(options, text)) return options[text];
  warn(`"${key}" deve ser ${Object.keys(options).join(', ')} (recebi ${show(value)}). Usando o padrão.`);
  return undefined;
}

function show(value: unknown): string {
  return typeof value === 'string' ? `"${value}"` : (JSON.stringify(value) ?? String(value));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Index of the channel that `reference` names (display name or file id,
 * ignoring case and accents), or -1. For `canal_inicial`.
 */
export function findChannelIndex(channels: readonly Schedule[], reference: string): number {
  const key = fold(reference.trim());
  return channels.findIndex((channel) => fold(channel.name) === key || fold(channel.id) === key);
}
