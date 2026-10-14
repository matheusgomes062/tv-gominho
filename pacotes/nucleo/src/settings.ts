// User settings (docs/configuracoes.md). Layers, from weakest to strongest:
//   DEFAULT_SETTINGS < biblioteca/configuracoes.yaml < choices made in the app menu.
// The file and the menu only hold what differs from the layer below, as a
// `PartialSettings`; `mergeSettings` stacks them into a complete `Settings`.

import { parse } from 'yaml';
import { fold } from './paths';
import type { LibraryWarning, Schedule } from './types';

/** 'continuous': the day's schedule loops 24h. 'real': follows the wall clock. 'fromStart': always begins at the first block. */
export type ScheduleMode = 'continuous' | 'real' | 'fromStart';
export type CrtIntensity = 'soft' | 'medium' | 'strong';
/** '4:3': pillarboxed 4:3 frame. 'stretch': fill the screen. 'original': the video's own shape, contained. */
export type AspectMode = '4:3' | 'stretch' | 'original';
export type StartMode = 'tv' | 'library';

export interface CrtSettings {
  enabled: boolean;
  intensity: CrtIntensity;
  curvature: boolean;
  scanlines: boolean;
}

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
  /** Small HH:MM clock on the TV screen. */
  clock: boolean;
  // TODO(phase 2): `marca_dagua` (watermark image) and `idioma`.
}

export type PartialSettings = Partial<Omit<Settings, 'crt'>> & { crt?: Partial<CrtSettings> };

export const DEFAULT_SETTINGS: Settings = {
  startMode: 'tv',
  startChannel: null,
  channelsPerShow: true,
  schedule: 'continuous',
  crt: { enabled: true, intensity: 'medium', curvature: true, scanlines: true },
  channelChangeStatic: true,
  aspect: '4:3',
  interstitials: true,
  commercials: true,
  clock: false,
};

/** Layers `partial` on top of `base`; fields missing from `partial` keep the base value. */
export function mergeSettings(base: Settings, partial: PartialSettings | undefined): Settings {
  if (!partial) return base;
  const { crt, ...rest } = partial;
  const merged: Settings = { ...base, ...definedOnly(rest), crt: { ...base.crt, ...definedOnly(crt) } };
  return merged;
}

function definedOnly<T extends object>(value: T | undefined): Partial<T> {
  return Object.fromEntries(Object.entries(value ?? {}).filter(([, entry]) => entry !== undefined)) as Partial<T>;
}

const ALLOWED = {
  startMode: ['tv', 'library'],
  schedule: ['continuous', 'real', 'fromStart'],
  aspect: ['4:3', 'stretch', 'original'],
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
  if (value.startChannel === null || typeof value.startChannel === 'string') result.startChannel = value.startChannel;
  if (isRecord(value.crt)) {
    result.crt = definedOnly({
      enabled: flag(value.crt, 'enabled'),
      intensity: option(value.crt, 'intensity', ALLOWED.intensity),
      curvature: flag(value.crt, 'curvature'),
      scanlines: flag(value.crt, 'scanlines'),
    });
  }
  return definedOnly(result);
}

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
  const set = <K extends keyof Omit<Settings, 'crt'>>(key: K, value: Settings[K] | undefined) => {
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
    else if (key === 'curvatura') crt.curvature = bool(label, entry, warn);
    else if (key === 'linhas') crt.scanlines = bool(label, entry, warn);
    else if (key === 'intensidade') {
      crt.intensity = choice(label, entry, { suave: 'soft', media: 'medium', forte: 'strong' }, warn);
    } else warn(`Opção desconhecida: "${label}". Ela foi ignorada.`);
  }
  return definedOnly(crt);
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
