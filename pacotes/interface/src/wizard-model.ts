import {
  AD_BREAK_LIMITS,
  DEFAULT_AD_BREAKS,
  WEEKDAYS,
  dayNumberToIso,
  formatTimeOfDay,
  generateSchedule,
  gradeBackupName,
  isoToDayNumber,
  bumperBrands,
  bumperEras,
  pickInterstitialRef,
  preservePositions,
  weekdayOf,
  type AdBreakSettings,
  type BrandOption,
  type GenerateBlock,
  type GenerateOptions,
  type GeneratedSchedule,
  type Library,
  type Schedule,
  type Weekday,
} from '@tv-gominho/nucleo';

// The model of the "Criar uma programação" wizard: steps, what each step needs, how the answers
// become generator options and how the channel file is named. No React or DOM in here, so
// it is all testable (see wizard-model.test.ts); WeekWizard.tsx only draws it.

/**
 * The four screens of the wizard, in order, plus the "Ajustes avançados" ones: a list (advanced) that opens
 * commercials, bumpers (brand and era) and replacing an existing channel (replace). They are off the main path:
 * the defaults (follow the general settings, any brand, a new channel) are already right.
 */
export type StepId = 'when' | 'shows' | 'review' | 'save' | 'advanced' | 'commercials' | 'bumpers' | 'replace';

export const STEPS: ReadonlyArray<{ id: StepId; title: string; help: string }> = [
  { id: 'when', title: 'Quando?', help: 'Em que horas e em quais dias o canal fica no ar.' },
  { id: 'shows', title: 'O que passa?', help: 'Os desenhos que entram no canal.' },
  { id: 'review', title: 'Nome e prévia', help: 'Dê um nome ao canal e confira o que vai passar.' },
  { id: 'save', title: 'Salvar', help: 'Confira e guarde o canal. Em cada linha, “Mudar” volta à tela certa.' },
];

export const ADVANCED_STEPS: ReadonlyArray<{ id: StepId; title: string; help: string }> = [
  { id: 'advanced', title: 'Ajustes avançados', help: 'O que quase nunca precisa mudar. Tudo começa no jeito padrão.' },
  { id: 'commercials', title: 'Comerciais', help: 'Os intervalos comerciais deste canal.' },
  { id: 'bumpers', title: 'Vinhetas', help: 'A marca e a época das vinhetas.' },
  { id: 'replace', title: 'Trocar um canal existente', help: 'Por padrão o canal é novo e nada que já existe muda. Aqui dá para refazer um canal que já existe.' },
];

/** The title and help of any screen. */
export function stepInfo(step: StepId): { id: StepId; title: string; help: string } {
  return STEPS.find((entry) => entry.id === step) ?? ADVANCED_STEPS.find((entry) => entry.id === step)!;
}

/** A time range of the day: seconds since midnight, the end after the start. */
export interface TimeRange {
  start: number;
  end: number;
}

export const MAX_RANGES = 3;
/** Custom times move in steps of this many seconds. */
export const TIME_STEP = 15 * 60;
export const MIN_RANGE = 15 * 60;
export const LAST_TIME = 23 * 3600 + 45 * 60;
export const MAX_NAME_LENGTH = 40;

const hours = (from: number, to: number): TimeRange => ({ start: from * 3600, end: to * 3600 });

export type PresetId = 'morning' | 'afternoon' | 'both' | 'custom';

export const RANGE_PRESETS: ReadonlyArray<{ id: PresetId; label: string; ranges: TimeRange[] }> = [
  { id: 'morning', label: 'Manhã', ranges: [hours(8, 12)] },
  { id: 'afternoon', label: 'Tarde', ranges: [hours(14, 18)] },
  { id: 'both', label: 'Manhã e tarde', ranges: [hours(8, 12), hours(14, 18)] },
  { id: 'custom', label: 'Faixas próprias', ranges: [hours(8, 12)] },
];

export const DAY_LABELS: Record<Weekday, string> = {
  dom: 'Domingo',
  seg: 'Segunda',
  ter: 'Terça',
  qua: 'Quarta',
  qui: 'Quinta',
  sex: 'Sexta',
  sab: 'Sábado',
};

/** Monday first, the way a Brazilian week is read. */
export const DAY_ORDER: readonly Weekday[] = ['seg', 'ter', 'qua', 'qui', 'sex', 'sab', 'dom'];

export const DAY_PRESETS: ReadonlyArray<{ id: string; label: string; days: Weekday[] }> = [
  { id: 'week', label: 'Segunda a sexta', days: ['seg', 'ter', 'qua', 'qui', 'sex'] },
  { id: 'weekend', label: 'Fim de semana', days: ['sab', 'dom'] },
  { id: 'all', label: 'Todos os dias', days: [...DAY_ORDER] },
];

export interface WizardState {
  preset: PresetId;
  ranges: TimeRange[];
  days: Weekday[];
  /** "all": every show, in the order the generator picks. "pick": only `picked`, in that order. */
  showMode: 'all' | 'pick';
  /** Show ids in the order they take turns. */
  picked: string[];
  /** "general": the channel follows the general break settings. "custom": it has its own, in `ad`. */
  adMode: 'general' | 'custom';
  /** The channel's own break rules (used with adMode "custom"); starts as a copy of the general ones. */
  ad: AdBreakSettings;
  /** A word the bumpers' path must carry (a brand folder, "tv-globinho"); "" = any brand. */
  brand: string;
  /** The year of the bumpers, or null = any era. */
  era: number | null;
  name: string;
  /** The id (grade file name) of the channel this one replaces; null = a new channel, the default. */
  target: string | null;
  /** The person confirmed replacing `target`. */
  confirmed: boolean;
}

export const DEFAULT_NAME = 'Meu canal';

/** `general` seeds the channel's own break rules: the ones the app plays with now. */
export function initialState(general: AdBreakSettings = DEFAULT_AD_BREAKS): WizardState {
  return {
    preset: 'morning',
    ranges: RANGE_PRESETS[0]!.ranges.map((range) => ({ ...range })),
    days: [...DAY_PRESETS[0]!.days],
    showMode: 'all',
    picked: [],
    adMode: 'general',
    ad: { ...general },
    brand: '',
    era: null,
    name: DEFAULT_NAME,
    target: null,
    confirmed: false,
  };
}

// ---------------------------------------------------------------- steps

/** The step after `step` on the main path; the last one stays. */
export function nextStep(step: StepId): StepId {
  const index = STEPS.findIndex((entry) => entry.id === step);
  return STEPS[Math.min(STEPS.length - 1, index + 1)]!.id;
}

/** The step before on the main path, or null on the first one. */
export function previousStep(step: StepId): StepId | null {
  const index = STEPS.findIndex((entry) => entry.id === step);
  return index <= 0 ? null : STEPS[index - 1]!.id;
}

/** The place of a main step in the path (0 for the first); the advanced screens belong to no place (-1). */
export function stepIndex(step: StepId): number {
  return STEPS.findIndex((entry) => entry.id === step);
}

/** The one-line header of a screen: "Passo 3 de 4 · Nome e prévia", or "Ajustes avançados · Comerciais". */
export function stepHeading(step: StepId): string {
  const index = stepIndex(step);
  if (index >= 0) return `Passo ${index + 1} de ${STEPS.length} · ${STEPS[index]!.title}`;
  return step === 'advanced' ? stepInfo(step).title : `Ajustes avançados · ${stepInfo(step).title}`;
}

/**
 * Where the person is and how they got there. Back goes to the screen they came from; Avançar goes on, except
 * on a screen opened with "Mudar" (changing), where it goes back to the screen that asked ("Pronto").
 */
export interface Nav {
  step: StepId;
  /** Opened with "Mudar": Avançar returns to where it was opened. */
  changing: boolean;
  trail: ReadonlyArray<{ step: StepId; changing: boolean }>;
}

export function startNav(step: StepId = 'when'): Nav {
  return { step, changing: false, trail: [] };
}

const push = (nav: Nav, step: StepId, changing: boolean): Nav => ({ step, changing, trail: [...nav.trail, { step: nav.step, changing: nav.changing }] });

/** Opens a screen on top of this one (the advanced ones, or the one an AI proposal needs). */
export function openStep(nav: Nav, step: StepId): Nav {
  return push(nav, step, false);
}

/** "Mudar": opens the screen so that finishing it comes back to the current one. */
export function changeStep(nav: Nav, step: StepId): Nav {
  return push(nav, step, true);
}

/** Back to the previous screen, or null when this is the first (Back there leaves the wizard). */
export function backNav(nav: Nav): Nav | null {
  const last = nav.trail.at(-1);
  return last ? { step: last.step, changing: last.changing, trail: nav.trail.slice(0, -1) } : null;
}

/** Avançar / Pronto. */
export function advanceNav(nav: Nav): Nav {
  const inAdvanced = stepIndex(nav.step) < 0;
  if (nav.changing || inAdvanced) return backNav(nav) ?? push(nav, 'review', false);
  return push(nav, nextStep(nav.step), false);
}

/** The label of the button that moves on: "Avançar", or "Pronto" when it only comes back. */
export function advanceLabel(nav: Nav): string {
  return nav.changing || stepIndex(nav.step) < 0 ? 'Pronto' : 'Avançar';
}

/**
 * Whether leaving the wizard would lose something: it is past the first screen, or an answer differs from the
 * state it opened with (`fresh`, from initialState).
 */
export function wizardDirty(step: StepId, state: WizardState, fresh: WizardState): boolean {
  return step !== 'when' || JSON.stringify(state) !== JSON.stringify(fresh);
}

// ---------------------------------------------------------------- time ranges

export function applyPreset(state: WizardState, preset: PresetId): WizardState {
  // Custom keeps what is on screen, so a preset can be fine-tuned.
  const ranges = preset === 'custom' ? state.ranges : RANGE_PRESETS.find((entry) => entry.id === preset)!.ranges;
  return { ...state, preset, ranges: ranges.map((range) => ({ ...range })) };
}

/** The one-press shortcut of the first screen: what most people want, morning on weekdays. */
export const QUICK_PRESET = { label: 'Manhã, seg a sex', preset: 'morning' as PresetId, days: DAY_PRESETS[0]!.days };

/** Applies the shortcut: the morning range and the weekdays, whatever was chosen before. */
export function applyQuickPreset(state: WizardState): WizardState {
  return { ...applyPreset(state, QUICK_PRESET.preset), days: [...QUICK_PRESET.days] };
}

export function formatRange(range: TimeRange): string {
  return `${formatTimeOfDay(range.start)}–${formatTimeOfDay(range.end)}`;
}

/** A time moved by `direction` steps, clamped to the day (00:00 to 23:45). */
export function stepTime(seconds: number, direction: 1 | -1): number {
  const snapped = Math.round(seconds / TIME_STEP) * TIME_STEP;
  return Math.min(LAST_TIME, Math.max(0, snapped + direction * TIME_STEP));
}

/**
 * Moves one end of a range. The end never goes closer than 15 minutes to the start, and moving the
 * start too close to the end drags the end along, so stepping through the day never leaves a broken range.
 */
export function moveRangeEdge(ranges: TimeRange[], index: number, edge: 'start' | 'end', direction: 1 | -1): TimeRange[] {
  return ranges.map((range, i) => {
    if (i !== index) return range;
    if (edge === 'end') return { ...range, end: Math.min(LAST_TIME, Math.max(range.start + MIN_RANGE, stepTime(range.end, direction))) };
    const start = Math.min(LAST_TIME - MIN_RANGE, stepTime(range.start, direction));
    const end = range.end <= start + MIN_RANGE - 1 ? Math.min(LAST_TIME, start + MIN_RANGE) : range.end;
    return { start, end };
  });
}

/** Adds a range of two hours after the last one (or at 08:00), when there is room. */
export function addRange(ranges: TimeRange[]): TimeRange[] {
  if (ranges.length >= MAX_RANGES) return ranges;
  const last = [...ranges].sort((a, b) => a.start - b.start).at(-1);
  const start = last ? Math.min(LAST_TIME - 2 * 3600, last.end + 2 * 3600) : 8 * 3600;
  return [...ranges, { start, end: Math.min(LAST_TIME, start + 2 * 3600) }];
}

export function removeRange(ranges: TimeRange[], index: number): TimeRange[] {
  return ranges.length <= 1 ? ranges : ranges.filter((_, i) => i !== index);
}

/** Ranges in time order. */
export function sortedRanges(ranges: TimeRange[]): TimeRange[] {
  return [...ranges].sort((a, b) => a.start - b.start || a.end - b.end);
}

/** Why the ranges cannot be used, in Portuguese, or null when they are fine. */
export function rangesProblem(ranges: TimeRange[]): string | null {
  if (ranges.length === 0) return 'Escolha pelo menos uma faixa de horário.';
  if (ranges.length > MAX_RANGES) return `Use no máximo ${MAX_RANGES} faixas de horário.`;
  for (const range of ranges) {
    if (range.end <= range.start) return `A faixa ${formatRange(range)} precisa terminar depois de começar.`;
    if (range.end - range.start < MIN_RANGE) return `A faixa ${formatRange(range)} é curta demais: use pelo menos 15 minutos.`;
  }
  const sorted = sortedRanges(ranges);
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i]!.start < sorted[i - 1]!.end) {
      return `As faixas ${formatRange(sorted[i - 1]!)} e ${formatRange(sorted[i]!)} se sobrepõem.`;
    }
  }
  return null;
}

// ---------------------------------------------------------------- days and shows

export function toggleDay(days: Weekday[], day: Weekday): Weekday[] {
  return days.includes(day) ? days.filter((entry) => entry !== day) : [...days, day];
}

/** Days in the order of the week (Sunday first), the way the grade file lists them. */
export function sortedDays(days: Weekday[]): Weekday[] {
  return WEEKDAYS.filter((day) => days.includes(day));
}

/** What the days of "Quando?" are, as one single choice: a shortcut, or "Escolher dias" (the seven checkboxes). */
export type DaysChoice = 'week' | 'weekend' | 'all' | 'pick';

export const DAYS_CHOICES: ReadonlyArray<{ id: DaysChoice; label: string }> = [
  { id: 'week', label: 'Seg a sex' },
  { id: 'weekend', label: 'Fim de semana' },
  { id: 'all', label: 'Todos os dias' },
  { id: 'pick', label: 'Escolher dias' },
];

/** Which option of the days is on: the shortcut the days match, unless the person asked to choose them one by one. */
export function daysChoiceOf(days: readonly Weekday[], picking: boolean): DaysChoice {
  if (picking) return 'pick';
  const preset = DAY_PRESETS.find((entry) => entry.days.length === days.length && entry.days.every((day) => days.includes(day)));
  return (preset?.id as DaysChoice | undefined) ?? 'pick';
}

export function daysSummary(days: Weekday[]): string {
  const preset = DAY_PRESETS.find((entry) => entry.days.length === days.length && entry.days.every((day) => days.includes(day)));
  if (preset) return preset.label;
  return DAY_ORDER.filter((day) => days.includes(day))
    .map((day) => DAY_LABELS[day])
    .join(', ');
}

export function togglePicked(picked: string[], id: string): string[] {
  return picked.includes(id) ? picked.filter((entry) => entry !== id) : [...picked, id];
}

/** Moves a picked show earlier (-1) or later (1) in the order they take turns. */
export function movePicked(picked: string[], id: string, direction: 1 | -1): string[] {
  const from = picked.indexOf(id);
  const to = from + direction;
  if (from < 0 || to < 0 || to >= picked.length) return picked;
  const result = [...picked];
  [result[from], result[to]] = [result[to]!, result[from]!];
  return result;
}

// ---------------------------------------------------------------- validation

/** Why the step cannot move on, in Portuguese, or null. `showCount` is how many shows the library has. */
export function stepProblem(step: StepId, state: WizardState, showCount: number): string | null {
  switch (step) {
    case 'when':
      return rangesProblem(state.ranges) ?? (state.days.length === 0 ? 'Escolha pelo menos um dia da semana.' : null);
    case 'shows':
      if (showCount === 0) return 'A biblioteca não tem programas com episódios.';
      return state.showMode === 'pick' && state.picked.length === 0 ? 'Escolha pelo menos um programa, ou deixe “Todos os programas”.' : null;
    case 'advanced':
    case 'commercials':
    case 'bumpers':
    case 'replace':
      return null;
    case 'review':
      if (state.name.trim() === '') return 'Dê um nome ao canal.';
      return state.name.trim().length > MAX_NAME_LENGTH ? `Use no máximo ${MAX_NAME_LENGTH} letras no nome.` : null;
    case 'save':
      return state.target !== null && !state.confirmed ? 'Para trocar o canal, marque a confirmação. O arquivo antigo fica guardado como cópia de segurança.' : null;
  }
}

/** The first step with a problem, or null when the whole wizard is ready to save. */
export function firstProblemStep(state: WizardState, showCount: number): StepId | null {
  return STEPS.find((step) => stepProblem(step.id, state, showCount) !== null)?.id ?? null;
}

// ---------------------------------------------------------------- the summary

/** A row of the last screen: what was chosen, and the screen "Mudar" opens for it. */
export interface SummaryLine {
  id: string;
  label: string;
  value: string;
  step: StepId;
}

export interface SummaryContext {
  library: Library;
  /** The grade file name (without extension) the channel will have. */
  fileName: string;
}

/** The brand and era in words: "Qualquer marca, qualquer época". */
export function bumpersSummary(state: Pick<WizardState, 'brand' | 'era'>): string {
  return `${state.brand === '' ? 'Qualquer marca' : state.brand}, ${state.era === null ? 'qualquer época' : state.era}`;
}

/** New channel, or the one replaced, in words. */
export function targetSummary(state: Pick<WizardState, 'target'>, library: Library): string {
  if (state.target === null) return 'Canal novo';
  const channel = library.schedules.find((schedule) => schedule.id === state.target);
  return `Trocar o canal “${channel?.name ?? state.target}”`;
}

/** The answers of the wizard, one row each, with the screen that changes it. */
export function summaryLines(state: WizardState, { library, fileName }: SummaryContext): SummaryLine[] {
  const shows =
    state.showMode === 'all' ? 'Todos os programas' : state.picked.map((id) => library.shows.find((show) => show.id === id)?.title ?? id).join(' → ');
  const abertura = bumperChoice(library, state)[0]!.ref;
  return [
    { id: 'name', label: 'Canal', value: state.name.trim(), step: 'review' },
    { id: 'ranges', label: 'Horários', value: sortedRanges(state.ranges).map(formatRange).join(' e '), step: 'when' },
    { id: 'days', label: 'Dias', value: daysSummary(state.days), step: 'when' },
    { id: 'shows', label: 'Programas', value: shows, step: 'shows' },
    {
      id: 'commercials',
      label: 'Comerciais',
      value: state.adMode === 'custom' ? `Regras próprias: ${adSummary(state.ad)}` : 'Seguir a configuração geral',
      step: 'commercials',
    },
    { id: 'bumpers', label: 'Vinhetas', value: `${bumpersSummary(state)}${abertura?.includes('/') ? ` · abertura ${abertura}` : ''}`, step: 'bumpers' },
    { id: 'file', label: 'Arquivo', value: `${library.root}grades/${fileName}.yaml · ${targetSummary(state, library)}`, step: 'replace' },
  ];
}

/** The advanced screens, each with what is chosen now (the default unless changed). */
export function advancedLines(state: WizardState, library: Library): Array<{ id: StepId; label: string; value: string; changed: boolean }> {
  const custom = state.adMode === 'custom';
  return [
    { id: 'commercials' as StepId, label: 'Comerciais', value: custom ? 'Regras próprias deste canal' : 'Seguir a configuração geral', changed: custom },
    { id: 'bumpers' as StepId, label: 'Vinhetas', value: bumpersSummary(state), changed: state.brand !== '' || state.era !== null },
    { id: 'replace' as StepId, label: 'Trocar um canal existente', value: state.target === null ? 'Não: criar um canal novo' : targetSummary(state, library), changed: state.target !== null },
  ];
}

// ---------------------------------------------------------------- the grade

export function toBlocks(ranges: TimeRange[]): GenerateBlock[] {
  return sortedRanges(ranges).map((range) => ({ start: range.start, length: range.end - range.start }));
}

/**
 * What generateSchedule needs for the answers. Throws if they are not valid (see stepProblem).
 * `settings` are the ones the TV will play with (the user's choices over the library's): they decide the estimates.
 */
export function toGenerateOptions(state: WizardState, startDate: string, settings?: GenerateOptions['settings']): GenerateOptions {
  const problem = stepProblem('when', state, 1) ?? stepProblem('shows', state, 1) ?? stepProblem('review', state, 1);
  if (problem) throw new Error(problem);
  return {
    name: state.name.trim(),
    shows: state.showMode === 'pick' ? state.picked : undefined,
    blocks: toBlocks(state.ranges),
    days: sortedDays(state.days),
    startDate,
    brand: state.brand,
    era: state.era ?? undefined,
    adBreaks: toAdBreaks(state),
    ...(settings ? { settings } : {}),
  };
}

// ---------------------------------------------------------------- commercials

/** The channel's own break rules for the grade (`intervalos`), or undefined when it follows the general ones. */
export function toAdBreaks(state: WizardState): Partial<AdBreakSettings> | undefined {
  return state.adMode === 'custom' ? { ...state.ad } : undefined;
}

/** Moves "a cada N minutos" or "N comerciais" by one, within the limits of the settings. */
export function stepAd(ad: AdBreakSettings, key: 'every' | 'ads', direction: 1 | -1): AdBreakSettings {
  const { min, max } = AD_BREAK_LIMITS[key];
  return { ...ad, [key]: Math.min(max, Math.max(min, ad[key] + direction)) };
}

/** The rules in a sentence: "a cada 8 min, 3 comerciais por intervalo, ...". */
export function adSummary(ad: AdBreakSettings): string {
  const parts = [
    ad.every > 0 ? `intervalo a cada ${ad.every} min de episódio` : 'sem intervalos no meio do episódio',
    `${ad.ads} ${ad.ads === 1 ? 'comercial' : 'comerciais'} por intervalo`,
    ad.afterEpisode ? 'intervalo depois de cada episódio' : 'sem intervalo depois do episódio',
    ad.bumpers ? 'com vinhetas de entrada e saída' : 'sem vinhetas de entrada e saída',
  ];
  return parts.join(', ');
}

// ---------------------------------------------------------------- bumpers (brand and era)

export { bumperBrands, bumperEras, type BrandOption };


/** Picks a brand. The era is kept only if that brand has it. */
export function chooseBrand(state: WizardState, library: Library, brand: string): WizardState {
  const eras = bumperEras(library, brand);
  return { ...state, brand, era: state.era !== null && eras.includes(state.era) ? state.era : null };
}

/** Moves the era through "any era" and the years found: direction 1 goes to a later year. */
export function stepEra(eras: readonly number[], era: number | null, direction: 1 | -1): number | null {
  const options: Array<number | null> = [null, ...eras];
  const at = Math.max(0, options.indexOf(era));
  return options[(at + direction + options.length) % options.length] ?? null;
}

/** What the generator will use as opening, closing and break bumpers for the answers (null = none in the library). */
export function bumperChoice(library: Library, state: Pick<WizardState, 'brand' | 'era'>): Array<{ label: string; ref: string | null }> {
  const era = state.era ?? undefined;
  return [
    { label: 'Abertura', ref: pickInterstitialRef(library, 'aberturas', state.brand, era) },
    { label: 'Encerramento', ref: pickInterstitialRef(library, 'encerramentos', state.brand, era) },
    { label: 'Intervalos', ref: pickInterstitialRef(library, 'intervalos', state.brand, era) },
  ];
}

// ---------------------------------------------------------------- new channel or replace

/** The channels of the library that are files in grades/ (the automatic and per-show channels are not). */
export function replaceableChannels(library: Library): Schedule[] {
  return library.schedules;
}

/** Replace `channel`: the name the channel has is the starting point, and the confirmation starts unmarked. */
export function chooseReplace(state: WizardState, channel: Schedule): WizardState {
  return { ...state, target: channel.id, name: channel.name, confirmed: false };
}

/** Back to a new channel. */
export function chooseNew(state: WizardState): WizardState {
  return { ...state, target: null, confirmed: false };
}

export interface ReplacePlan {
  /** The grade file (without extension) that is overwritten. */
  fileName: string;
  /** Its path in the library. */
  path: string;
  /** The name of the copy kept before overwriting, in the same folder (it never loads as a channel). */
  backupName: string;
  backupPath: string;
}

/**
 * Where the new channel goes when it replaces `channel`: over the same file, after the old one is copied to a backup named
 * with `today`. `inGrades` lists the file names already in grades/, so the backup never takes a name that is in use.
 */
export function planReplace(channel: Pick<Schedule, 'path'>, today: string, inGrades: Iterable<string>, root: string): ReplacePlan {
  const fileName = gradeFileBase(channel.path);
  const backupName = gradeBackupName(fileName, today, inGrades);
  return { fileName, path: gradePath(root, fileName), backupName, backupPath: `${root}grades/${backupName}` };
}

export interface BuildInput {
  state: WizardState;
  library: Library;
  durationOf: (path: string) => number | undefined;
  /** What the TV plays with: the user's choices over the library's. */
  settings: GenerateOptions['settings'];
  /** "YYYY-MM-DD": the first day of the channel, and the day the saved positions are taken. */
  today: string;
  /** The names of the grade files that exist, to avoid them for a new channel. */
  taken: readonly string[];
}

export interface BuiltChannel {
  generated: GeneratedSchedule;
  /** The grade file name without extension; also the channel id, which seeds the day's draws. */
  fileName: string;
  /** The channel it replaces, or null for a new one. */
  replaces: Schedule | null;
}

/**
 * The channel for the answers, ready to preview and to write. A new one takes a free file name. A replacement takes the
 * id and file of the old one, and with the positions every show had in the old one on `today` (preservePositions), so
 * nothing jumps back or skips. The id is the file name because it seeds the draws: the preview must be what the TV airs.
 */
export function buildChannel({ state, library, durationOf, settings, today, taken }: BuildInput): BuiltChannel {
  const replaces = state.target === null ? null : (library.schedules.find((schedule) => schedule.id === state.target) ?? null);
  if (state.target !== null && !replaces) throw new Error('O canal que seria trocado não está mais na biblioteca.');
  const fileName = replaces ? gradeFileBase(replaces.path) : uniqueFileName(state.name, taken);
  const generated = generateSchedule(library, durationOf, toGenerateOptions(state, today, settings));
  const fresh: Schedule = { ...generated.schedule, id: fileName, path: gradePath(library.root, fileName) };
  const schedule = replaces ? preservePositions(replaces, fresh, library, today) : fresh;
  return { generated: { ...generated, schedule }, fileName, replaces };
}

// ---------------------------------------------------------------- the preview days

/** `count` days in a row from `from` ("YYYY-MM-DD"). */
export function previewDates(from: string, count = 7): string[] {
  const first = isoToDayNumber(from);
  return Array.from({ length: count }, (_, i) => dayNumberToIso(first + i));
}

const SHORT_DAY: Record<Weekday, string> = { dom: 'Dom', seg: 'Seg', ter: 'Ter', qua: 'Qua', qui: 'Qui', sex: 'Sex', sab: 'Sáb' };

/** "Seg 22/10". */
export function dayLabel(date: string): string {
  const [, month, day] = date.split('-');
  return `${SHORT_DAY[weekdayOf(isoToDayNumber(date))]} ${day}/${month}`;
}

/** "Segunda, 22/10". */
export function longDayLabel(date: string): string {
  const [, month, day] = date.split('-');
  return `${DAY_LABELS[weekdayOf(isoToDayNumber(date))]}, ${day}/${month}`;
}

// ---------------------------------------------------------------- the file

const RESERVED = new Set(['con', 'prn', 'aux', 'nul', 'com1', 'com2', 'com3', 'com4', 'lpt1', 'lpt2', 'lpt3']);

/** "Desenhos da Manhã!" -> "desenhos-da-manha": letters and digits joined by hyphens, as the grade file names are. */
export function slugify(name: string): string {
  const slug = name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_NAME_LENGTH)
    .replace(/-+$/g, '');
  if (slug === '') return 'canal';
  return RESERVED.has(slug) ? `${slug}-canal` : slug;
}

/** Strips the folder and the .yaml/.yml extension from a path in grades/. */
export function gradeFileBase(path: string): string {
  return (path.split('/').at(-1) ?? path).replace(/\.ya?ml$/i, '');
}

/**
 * The file name (without extension) for a new channel: the slug of its name, or `-2`, `-3`... when
 * that is taken. `taken` holds the names of the grade files that already exist, in any case.
 */
export function uniqueFileName(name: string, taken: Iterable<string>): string {
  const used = new Set([...taken].map((entry) => gradeFileBase(entry).toLowerCase()));
  const base = slugify(name);
  if (!used.has(base)) return base;
  for (let n = 2; ; n++) {
    const candidate = `${base}-${n}`;
    if (!used.has(candidate)) return candidate;
  }
}

/** Where a new grade goes inside the picked folder: grades/ under the library root ("" or "biblioteca/"). */
export function gradePath(root: string, fileName: string): string {
  return `${root}grades/${fileName}.yaml`;
}

/** Every file directly in grades/ (channels and backups alike), by name: the names a new backup must not take. */
export function gradeFolderFiles(files: readonly string[], root: string): string[] {
  const prefix = `${root}grades/`.toLowerCase();
  return files.filter((file) => file.toLowerCase().startsWith(prefix) && !file.slice(prefix.length).includes('/')).map((file) => file.slice(prefix.length));
}

/** The grade files in a library's file list, to avoid their names. */
export function existingGradeFiles(files: readonly string[], root: string): string[] {
  const prefix = `${root}grades/`.toLowerCase();
  return files.filter((file) => file.toLowerCase().startsWith(prefix) && /\.ya?ml$/i.test(file) && !file.slice(prefix.length).includes('/'));
}
