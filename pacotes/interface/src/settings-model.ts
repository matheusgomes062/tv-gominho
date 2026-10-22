import { AD_BREAK_LIMITS, applyTheme, type PartialSettings, type Schedule, type Settings, type Theme } from '@tv-gominho/nucleo';
import type { IconName } from './components/Icon';

// One description of every setting the overlays show: the quick bar and the full panel
// are both built from these, so a value is labelled the same way everywhere.

export interface Option<V = unknown> {
  value: V;
  label: string;
  /** A shorter label for the quick-settings tiles. */
  short?: string;
}

export interface SettingDef {
  /** Path inside Settings (e.g. "aspect", "crt.enabled"); also the key of the stored override. */
  key: string;
  /** Keys that tell where the value came from (defaults to `key`). */
  originKeys?: string[];
  label: string;
  /** Label of the quick-settings tile. */
  tile?: string;
  hint?: string;
  icon: IconName;
  /** switch: on/off. select: a short list of values. range: a number between min and max. */
  kind: 'switch' | 'select' | 'range';
  options: Option[];
  range?: { min: number; max: number; step: number; format(value: number): string };
  /** Shown under another setting's switch; greyed out and locked (no pointer or key changes it) when that does not apply. */
  dimmed?(settings: Settings): boolean;
  /** Why the setting is locked while `dimmed` is true; shown where the origin tag normally goes. */
  dimmedReason?: string;
  get(settings: Settings): unknown;
  set(value: unknown): PartialSettings;
}

const ON_OFF: Option<boolean>[] = [
  { value: true, label: 'Ligado' },
  { value: false, label: 'Desligado' },
];

export const THEME_LABELS: Record<Theme, string> = {
  classic: 'TV antiga',
  vhs: 'Fita VHS',
  modern: 'TV moderna',
  custom: 'Personalizado',
};

export const THEME_DESCRIPTIONS: Record<Theme, string> = {
  classic: 'Tubo de imagem curvo, linhas de varredura, tela 4:3 e chuvisco entre os canais. Textos verdes de TV antiga.',
  vhs: 'Imagem de fita: efeito forte, pouco curvo, 4:3 e chuvisco. Textos de videocassete, com PLAY e contador.',
  modern: 'Tela plana, sem efeito de tubo, no formato original do vídeo e sem chuvisco. Textos limpos e arredondados.',
  custom: 'Os ajustes feitos à mão depois de escolher um tema. O estilo dos textos continua o do último tema.',
};

const THEME_OPTIONS: Option<Theme>[] = (['classic', 'vhs', 'modern', 'custom'] as const).map((value) => ({
  value,
  label: THEME_LABELS[value],
  short: value === 'custom' ? 'Pessoal' : undefined,
}));

function def(definition: SettingDef): SettingDef {
  return definition;
}

/** Every setting by id; `channels` fills the "canal inicial" choices. */
export function buildDefs(channels: Schedule[], startChannel: string | null): Record<string, SettingDef> {
  const channelOptions: Option<string | null>[] = [
    { value: null, label: 'O primeiro' },
    ...channels.map((channel) => ({ value: channel.name as string | null, label: channel.name })),
  ];
  // A name from configuracoes.yaml that matches no channel name (e.g. a file id) still has to show up.
  if (startChannel !== null && !channelOptions.some((option) => option.value === startChannel)) {
    channelOptions.push({ value: startChannel, label: startChannel });
  }

  const list: SettingDef[] = [
    def({
      key: 'theme',
      label: 'Tema',
      tile: 'Tema',
      icon: 'palette',
      kind: 'select',
      options: THEME_OPTIONS,
      get: (s) => s.theme,
      set: (theme) => applyTheme(theme as Theme),
    }),
    def({
      key: 'osdSkin',
      label: 'Estilo dos textos na tela',
      hint: 'Número do canal, barra de informações e relógio.',
      icon: 'text',
      kind: 'select',
      options: [
        { value: 'classic', label: 'TV antiga' },
        { value: 'vhs', label: 'Fita VHS' },
        { value: 'modern', label: 'TV moderna' },
      ],
      get: (s) => s.osdSkin,
      set: (osdSkin) => ({ osdSkin: osdSkin as Settings['osdSkin'] }),
    }),
    // Imagem
    def({
      key: 'aspect',
      label: 'Proporção da tela',
      tile: 'Proporção',
      icon: 'aspect',
      kind: 'select',
      options: [
        { value: '4:3', label: '4:3' },
        { value: 'stretch', label: 'Esticar' },
        { value: 'original', label: 'Original' },
      ],
      get: (s) => s.aspect,
      set: (aspect) => ({ aspect: aspect as Settings['aspect'] }),
    }),
    def({
      key: 'crt.enabled',
      label: 'Efeito de TV de tubo (CRT)',
      icon: 'tube',
      kind: 'switch',
      options: ON_OFF,
      get: (s) => s.crt.enabled,
      set: (enabled) => ({ crt: { enabled: enabled as boolean } }),
    }),
    // The quick-settings tile: off, or on with one of the three intensities.
    def({
      key: 'crt.level',
      originKeys: ['crt.enabled', 'crt.intensity'],
      label: 'Efeito CRT',
      tile: 'Efeito CRT',
      icon: 'tube',
      kind: 'select',
      options: [
        { value: 'off', label: 'Desligado', short: 'Desligado' },
        { value: 'soft', label: 'Suave' },
        { value: 'medium', label: 'Média' },
        { value: 'strong', label: 'Forte' },
      ],
      get: (s) => (s.crt.enabled ? s.crt.intensity : 'off'),
      set: (level) =>
        level === 'off' ? { crt: { enabled: false } } : { crt: { enabled: true, intensity: level as Settings['crt']['intensity'] } },
    }),
    def({
      key: 'crt.intensity',
      label: 'Intensidade do efeito',
      icon: 'intensity',
      kind: 'select',
      options: [
        { value: 'soft', label: 'Suave' },
        { value: 'medium', label: 'Média' },
        { value: 'strong', label: 'Forte' },
      ],
      dimmed: (s) => !s.crt.enabled,
      dimmedReason: 'Efeito de tubo desligado',
      get: (s) => s.crt.intensity,
      set: (intensity) => ({ crt: { intensity: intensity as Settings['crt']['intensity'] } }),
    }),
    def({
      key: 'crt.curvature',
      label: 'Tela curva',
      tile: 'Curvatura',
      icon: 'curve',
      kind: 'range',
      options: [],
      range: { min: 0, max: 100, step: 10, format: (value) => `${value}%` },
      dimmed: (s) => !s.crt.enabled,
      dimmedReason: 'Efeito de tubo desligado',
      get: (s) => s.crt.curvature,
      set: (curvature) => ({ crt: { curvature: curvature as number } }),
    }),
    def({
      key: 'crt.scanlines',
      label: 'Linhas de varredura',
      icon: 'scanlines',
      kind: 'switch',
      options: ON_OFF,
      dimmed: (s) => !s.crt.enabled,
      dimmedReason: 'Efeito de tubo desligado',
      get: (s) => s.crt.scanlines,
      set: (scanlines) => ({ crt: { scanlines: scanlines as boolean } }),
    }),
    def({
      key: 'clock',
      label: 'Relógio na tela',
      tile: 'Relógio',
      icon: 'clock',
      kind: 'switch',
      options: ON_OFF,
      get: (s) => s.clock,
      set: (clock) => ({ clock: clock as boolean }),
    }),
    // Only the library's configuracoes.yaml can name the image, so without one the switch is locked.
    def({
      key: 'watermarkEnabled',
      label: "Marca d'água",
      icon: 'picture',
      kind: 'switch',
      options: ON_OFF,
      dimmed: (s) => s.watermark === null,
      dimmedReason: "Sem marca d'água na biblioteca",
      get: (s) => s.watermarkEnabled,
      set: (watermarkEnabled) => ({ watermarkEnabled: watermarkEnabled as boolean }),
    }),
    // Programação
    def({
      key: 'schedule',
      label: 'Horário da programação',
      tile: 'Horário',
      icon: 'calendar',
      kind: 'select',
      options: [
        { value: 'continuous', label: 'Contínuo' },
        { value: 'real', label: 'Horário real', short: 'Real' },
        { value: 'fromStart', label: 'Do início' },
      ],
      get: (s) => s.schedule,
      set: (schedule) => ({ schedule: schedule as Settings['schedule'] }),
    }),
    def({
      key: 'interstitials',
      label: 'Vinhetas',
      icon: 'interstitials',
      kind: 'switch',
      options: ON_OFF,
      get: (s) => s.interstitials,
      set: (interstitials) => ({ interstitials: interstitials as boolean }),
    }),
    def({
      key: 'commercials',
      label: 'Comerciais',
      tile: 'Comerciais',
      icon: 'ads',
      kind: 'switch',
      options: ON_OFF,
      get: (s) => s.commercials,
      set: (commercials) => ({ commercials: commercials as boolean }),
    }),
    // Canais
    def({
      key: 'startMode',
      label: 'Ao abrir, mostrar',
      icon: 'power',
      kind: 'select',
      options: [
        { value: 'tv', label: 'TV' },
        { value: 'library', label: 'Biblioteca' },
      ],
      get: (s) => s.startMode,
      set: (startMode) => ({ startMode: startMode as Settings['startMode'] }),
    }),
    def({
      key: 'startChannel',
      label: 'Canal inicial',
      hint: 'Só vale quando você ainda não escolheu um canal neste navegador.',
      icon: 'channel',
      kind: 'select',
      options: channelOptions,
      get: (s) => s.startChannel,
      set: (startChannel) => ({ startChannel: startChannel as string | null }),
    }),
    def({
      key: 'channelsPerShow',
      label: 'Um canal para cada programa',
      icon: 'grid',
      kind: 'switch',
      options: ON_OFF,
      get: (s) => s.channelsPerShow,
      set: (channelsPerShow) => ({ channelsPerShow: channelsPerShow as boolean }),
    }),
    def({
      key: 'channelChangeStatic',
      label: 'Chuvisco ao trocar de canal',
      icon: 'snow',
      kind: 'switch',
      options: ON_OFF,
      get: (s) => s.channelChangeStatic,
      set: (channelChangeStatic) => ({ channelChangeStatic: channelChangeStatic as boolean }),
    }),
    // Intervalos comerciais
    def({
      key: 'adBreaks.every',
      label: 'Intervalo a cada',
      hint: 'Minutos de episódio entre um intervalo e outro. Desligado: só entre episódios.',
      icon: 'timer',
      kind: 'range',
      options: [],
      range: {
        min: AD_BREAK_LIMITS.every.min,
        max: AD_BREAK_LIMITS.every.max,
        step: 1,
        format: (value) => (value === 0 ? 'Desligado' : `${value} min`),
      },
      dimmed: (s) => !s.commercials,
      dimmedReason: 'Comerciais desligados',
      get: (s) => s.adBreaks.every,
      set: (every) => ({ adBreaks: { every: every as number } }),
    }),
    def({
      key: 'adBreaks.ads',
      label: 'Comerciais por intervalo',
      icon: 'ads',
      kind: 'range',
      options: [],
      range: { min: AD_BREAK_LIMITS.ads.min, max: AD_BREAK_LIMITS.ads.max, step: 1, format: (value) => String(value) },
      dimmed: (s) => !s.commercials,
      dimmedReason: 'Comerciais desligados',
      get: (s) => s.adBreaks.ads,
      set: (ads) => ({ adBreaks: { ads: ads as number } }),
    }),
    def({
      key: 'adBreaks.afterEpisode',
      label: 'Intervalo depois de cada episódio',
      icon: 'episode',
      kind: 'switch',
      options: ON_OFF,
      dimmed: (s) => !s.commercials,
      dimmedReason: 'Comerciais desligados',
      get: (s) => s.adBreaks.afterEpisode,
      set: (afterEpisode) => ({ adBreaks: { afterEpisode: afterEpisode as boolean } }),
    }),
    def({
      key: 'adBreaks.bumpers',
      label: 'Vinhetas de intervalo',
      hint: 'Vinheta antes e depois dos comerciais (ex.: “TV Globinho volta já”).',
      icon: 'interstitials',
      kind: 'switch',
      options: ON_OFF,
      dimmed: (s) => !s.commercials || !s.interstitials,
      dimmedReason: 'Comerciais ou vinhetas desligados',
      get: (s) => s.adBreaks.bumpers,
      set: (bumpers) => ({ adBreaks: { bumpers: bumpers as boolean } }),
    }),
  ];
  return Object.fromEntries(list.map((item) => [item.key, item]));
}

export interface Category {
  id: string;
  label: string;
  icon: IconName;
  /** Setting keys, in order. The "Sobre" category has none: it is drawn by hand. */
  rows: string[];
}

export const CATEGORIES: Category[] = [
  { id: 'theme', label: 'Tema', icon: 'palette', rows: ['osdSkin'] },
  { id: 'picture', label: 'Imagem', icon: 'picture', rows: ['aspect', 'crt.enabled', 'crt.intensity', 'crt.curvature', 'crt.scanlines', 'clock', 'watermarkEnabled'] },
  { id: 'schedule', label: 'Como a TV passa', icon: 'calendar', rows: ['schedule', 'interstitials', 'commercials'] },
  { id: 'channels', label: 'Canais', icon: 'tv', rows: ['startMode', 'startChannel', 'channelsPerShow', 'channelChangeStatic'] },
  { id: 'ads', label: 'Intervalos comerciais', icon: 'ads', rows: ['adBreaks.every', 'adBreaks.ads', 'adBreaks.afterEpisode', 'adBreaks.bumpers'] },
  // Drawn by overlays/AiSettings.tsx: the key and the switch of "Pedir para a IA".
  { id: 'ia', label: 'Assistente de IA', icon: 'text', rows: [] },
  { id: 'about', label: 'Sobre e restaurar', icon: 'info', rows: [] },
];

/** The tiles of the quick-settings bar, in order (the "Todas as configurações" tile comes after them). */
export const QUICK_TILES = ['theme', 'crt.level', 'crt.curvature', 'aspect', 'schedule', 'commercials', 'clock'];

export function valueLabel(item: SettingDef, settings: Settings, short = false): string {
  const value = item.get(settings);
  if (item.kind === 'range') return item.range!.format(value as number);
  const option = item.options.find((entry) => entry.value === value);
  return (short ? option?.short : undefined) ?? option?.label ?? String(value);
}

/** The next/previous value of a select or switch, as a settings change (wraps around). */
export function cycled(item: SettingDef, settings: Settings, direction: 1 | -1): PartialSettings {
  const index = item.options.findIndex((option) => option.value === item.get(settings));
  const next = item.options[(index + direction + item.options.length) % item.options.length]!;
  return item.set(next.value);
}

/** A selector moved to the next (1) or previous (-1) value by a pointer click: left half of the value goes back. */
export function clickDirection(selector: Element, clientX: number): 1 | -1 {
  const box = selector.getBoundingClientRect();
  return clientX < box.left + box.width / 2 ? -1 : 1;
}

/** A range moved one step (clamped), or null when it would not change. */
export function stepped(item: SettingDef, settings: Settings, direction: 1 | -1): PartialSettings | null {
  const { min, max, step } = item.range!;
  const current = item.get(settings) as number;
  const snapped = Math.round(current / step) * step;
  const target = Math.min(max, Math.max(min, snapped + direction * step));
  return target === current ? null : item.set(target);
}

/** Enter/OK on a range: one step up, wrapping to the minimum after the maximum. */
export function steppedWrapping(item: SettingDef, settings: Settings): PartialSettings {
  const { min, max, step } = item.range!;
  const current = item.get(settings) as number;
  return item.set(current >= max ? min : Math.min(max, current + step));
}

/** A range set to a position along its track (0 to 1). */
export function rangeAt(item: SettingDef, settings: Settings, fraction: number): PartialSettings | null {
  const { min, max } = item.range!;
  const target = Math.round(min + Math.min(1, Math.max(0, fraction)) * (max - min));
  return target === item.get(settings) ? null : item.set(target);
}

export function rangeFraction(item: SettingDef, settings: Settings): number {
  const { min, max } = item.range!;
  return ((item.get(settings) as number) - min) / (max - min);
}

function isSet(partial: PartialSettings, key: string): boolean {
  const [first, second] = key.split('.') as [string, string | undefined];
  const value = (partial as Record<string, unknown>)[first];
  if (second === undefined) return value !== undefined;
  return (value as Record<string, unknown> | undefined)?.[second] !== undefined;
}

/** Where a value comes from, for the small tag next to it. */
export function originOf(item: SettingDef, overrides: PartialSettings, fromLibrary: PartialSettings): string | null {
  const keys = item.originKeys ?? [item.key];
  if (keys.some((key) => isSet(overrides, key))) return 'alterado por você';
  if (keys.some((key) => isSet(fromLibrary, key))) return 'da biblioteca';
  return null;
}
