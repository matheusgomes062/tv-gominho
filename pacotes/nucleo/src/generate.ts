// Builds a TV Globinho-style schedule from what is in the library: each block opens
// with an opening bumper, runs the shows in turn with promos between them and
// closes with a closing bumper, filling the time asked for (breaks included).

import { WEEKDAYS, formatTimeOfDay, type Weekday } from './dates';
import { resolveInterstitials } from './library';
import { fold, naturalCompare } from './paths';
import { hashString } from './random';
import { channelAdBreaks, type AdBreakSettings, type Settings } from './settings';
import type { Library, SavedPosition, Schedule, ScheduleBlock, ScheduleItem, Show } from './types';

export interface GenerateBlock {
  /** Seconds since midnight. */
  start: number;
  /** Air time to fill, breaks included, in seconds. */
  length: number;
}

export interface GenerateOptions {
  /** Channel name. Default "TV Gominho". */
  name?: string;
  description?: string;
  /** Show folder names, in the order they take turns. Default: every show with episodes, in library order. */
  shows?: string[];
  /** Bumpers whose path has this word win (aberturas/tv-globinho...). Default "globinho"; "" = any brand. */
  brand?: string;
  /** A year: bumpers whose names carry a year or range ("2003-2009") around it win. */
  era?: number;
  /** Default: one block from 08:00 to 12:00. */
  blocks?: GenerateBlock[];
  /** Air each show once, whatever the block length (the automatic channel). */
  oneRound?: boolean;
  days?: Weekday[];
  /** "YYYY-MM-DD": the first day; also where the episode count starts. */
  startDate: string;
  /**
   * The channel's own break rules (`intervalos` of the grade; what is left out follows the general ones). They are
   * written into the grade and used for the estimates, so the blocks close on time with the channel's breaks.
   */
  adBreaks?: Partial<AdBreakSettings>;
  /** The settings the channel will play with (the user's choices over the library's). Default: the library's. */
  settings?: Pick<Settings, 'interstitials' | 'commercials' | 'adBreaks'>;
}

export interface GeneratedSchedule {
  schedule: Schedule;
  /** Estimated air time of each block, breaks included, in seconds. */
  estimates: number[];
  /** Estimated start of each show item, in seconds since midnight, by block and item index. */
  itemStarts: Map<ScheduleItem, number>;
}

/** When nothing is known about a file (seconds). */
export const GUESS = { episode: 22 * 60, commercial: 30, bumper: 8, promo: 20 } as const;
/** Shows shorter than this air two episodes in a row, like the 11-minute segments on TV. */
const SHORT_EPISODE = 13 * 60;
const SAMPLE = 12;

export const DEFAULT_GENERATE_BLOCK: GenerateBlock = { start: 8 * 3600, length: 4 * 3600 };

export function generateSchedule(
  library: Library,
  durationOf: (path: string) => number | undefined,
  options: GenerateOptions,
): GeneratedSchedule {
  const shows = pickShows(library, options.shows, options.era);
  if (shows.length === 0) throw new Error('A biblioteca não tem programas com episódios.');
  const brand = options.brand ?? 'globinho';
  const pick = (category: string) => pickInterstitialRef(library, category, brand, options.era);

  const opening = pick('aberturas');
  const closing = pick('encerramentos');
  // Promos change every time: the brand's whole folder, not one file of the era.
  const promo = pickInterstitialRef(library, 'chamadas', brand, undefined);
  const bumpers = pickBumperGroup(library, brand, options.era);

  const settings = options.settings ?? library.settings;
  // The channel's own rules over the general ones; the general `commercials` switch still decides whether there are breaks at all.
  const ownBreaks = options.adBreaks && Object.keys(options.adBreaks).length > 0 ? options.adBreaks : undefined;
  const adBreaks: AdBreakSettings | null =
    settings.commercials && resolveInterstitials(library, 'comerciais').length > 0 ? channelAdBreaks(settings, { adBreaks: ownBreaks }) : null;
  const average = (paths: string[], guess: number) => averageDuration(paths, durationOf, guess);
  const adSeconds = adBreaks ? adBreaks.ads * average(resolveInterstitials(library, 'comerciais').map((i) => i.path), GUESS.commercial) : 0;
  const bumperSeconds = adBreaks?.bumpers && settings.interstitials ? 2 * average(refPaths(library, bumpers ?? 'intervalos'), GUESS.bumper) : 0;
  const breakSeconds = adSeconds + bumperSeconds;
  const refSeconds = (ref: string | null, guess: number) => (ref && settings.interstitials ? average(refPaths(library, ref), guess) : 0);

  // Air time of one show item: its episodes plus the breaks inside and after them.
  const costs = new Map<string, { count: number; seconds: number }>();
  for (const show of shows) {
    const episode = average(show.episodes.slice(0, SAMPLE).map((e) => e.path), GUESS.episode);
    const count = episode < SHORT_EPISODE ? 2 : 1;
    const breaks = adBreaks ? count * (middleBreaks(episode, adBreaks.every) + (adBreaks.afterEpisode ? 1 : 0)) : 0;
    costs.set(show.id, { count, seconds: count * episode + breaks * breakSeconds });
  }

  const itemStarts = new Map<ScheduleItem, number>();
  const estimates: number[] = [];
  let turn = 0;
  const blocks: ScheduleBlock[] = (options.blocks ?? [DEFAULT_GENERATE_BLOCK]).map((block) => {
    const items: ScheduleItem[] = [];
    let used = 0;
    if (opening) {
      items.push({ type: 'interstitial', ref: opening });
      used += refSeconds(opening, GUESS.bumper);
    }
    const closingSeconds = refSeconds(closing, GUESS.bumper);
    const promoSeconds = refSeconds(promo, GUESS.promo);
    let placed = 0;
    for (;;) {
      if (options.oneRound && placed === shows.length) break;
      const show = shows[turn % shows.length]!;
      const cost = costs.get(show.id)!;
      const gap = placed > 0 && promo ? promoSeconds : 0;
      // Stop at the item that lands closest to the end: one more only if it ends nearer the target than stopping here.
      const remaining = block.length - closingSeconds - used;
      if (placed > 0 && !options.oneRound && gap + cost.seconds / 2 > remaining) break;
      if (placed > 0 && promo) items.push({ type: 'interstitial', ref: promo });
      const item: ScheduleItem = { type: 'show', show: show.id, count: cost.count };
      items.push(item);
      itemStarts.set(item, block.start + used + gap);
      used += gap + cost.seconds;
      placed++;
      turn++;
    }
    if (closing) {
      items.push({ type: 'interstitial', ref: closing });
      used += closingSeconds;
    }
    estimates.push(used);
    return { start: block.start, items };
  });

  const schedule: Schedule = {
    id: 'tv-gominho',
    path: '',
    name: options.name ?? 'TV Gominho',
    description: options.description,
    startDate: options.startDate,
    days: options.days ?? WEEKDAYS.filter((day) => day !== 'sab' && day !== 'dom'),
    blocks,
    ...(bumpers ? { breakBumpersRef: bumpers } : {}),
    ...(ownBreaks ? { adBreaks: ownBreaks } : {}),
  };
  return { schedule, estimates, itemStarts };
}

/**
 * Without a list: every show with episodes that already existed in the era (by `ano`),
 * in a fixed shuffled order, so related shows (Dragon Ball, Z, GT) don't air back to back.
 */
function pickShows(library: Library, ids: string[] | undefined, era: number | undefined): Show[] {
  const playable = library.shows.filter((show) => show.episodes.length > 0);
  if (!ids) {
    const aired = playable.filter((show) => era === undefined || show.year === undefined || show.year <= era);
    const order = (show: Show) => hashString(`${show.id}|${era ?? ''}`);
    return (aired.length > 0 ? aired : playable).sort((a, b) => order(a) - order(b));
  }
  return ids.map((id) => {
    const show = playable.find((candidate) => candidate.id.toLowerCase() === id.toLowerCase());
    if (!show) {
      const known = library.shows.some((candidate) => candidate.id.toLowerCase() === id.toLowerCase());
      throw new Error(known ? `O programa "${id}" não tem episódios.` : `Não achei o programa "${id}" em programas/.`);
    }
    return show;
  });
}

/** Breaks the engine puts inside an episode of this length (see `breakPoints`; the 2-minute margins only matter for short ones). */
function middleBreaks(seconds: number, every: number): number {
  if (every <= 0 || seconds < every * 60 + 120) return 0;
  return Math.floor(seconds / (every * 60));
}

function averageDuration(paths: string[], durationOf: (path: string) => number | undefined, guess: number): number {
  const known = paths.map(durationOf).filter((d): d is number => d !== undefined && Number.isFinite(d) && d > 0);
  return known.length > 0 ? known.reduce((sum, d) => sum + d, 0) / known.length : guess;
}

function refPaths(library: Library, ref: string): string[] {
  return resolveInterstitials(library, ref).map((item) => item.path);
}

// ---------------------------------------------------------------- choosing bumpers

/** Years in a path: "2003-2009" -> [2003, 2009], "(2011)" -> [2011, 2011]. */
export function yearRange(text: string): [number, number] | null {
  const match = /(?:^|\D)((?:19|20)\d\d)(?:\s*[-–a]\s*((?:19|20)\d\d))?(?!\d)/.exec(text);
  if (!match) return null;
  const from = Number(match[1]);
  const to = match[2] ? Number(match[2]) : from;
  return from <= to ? [from, to] : [to, from];
}

/** How far a range is from a year: 0 inside it, then the distance to the nearest end; wide ranges lose ties. */
function eraDistance(range: [number, number] | null, era: number): number {
  if (!range) return 1000;
  const outside = era < range[0] ? range[0] - era : era > range[1] ? era - range[1] : 0;
  return outside * 100 + (range[1] - range[0]);
}

/**
 * The best reference in a bumper category for the brand and era: a subfolder
 * ("aberturas/tv-globinho"), a file when only one fits the era, or the whole
 * category. Null when the category is empty.
 */
export function pickInterstitialRef(library: Library, category: string, brand: string, era: number | undefined): string | null {
  let items = resolveInterstitials(library, category);
  if (items.length === 0) return null;
  const branded = brand ? items.filter((item) => fold(item.relativePath).includes(fold(brand))) : items;
  if (branded.length > 0) items = branded;
  const folderOf = (path: string) => path.split('/').slice(0, 2).join('/');

  if (era !== undefined) {
    const distance = (path: string) => eraDistance(yearRange(path.slice(category.length)), era);
    const best = Math.min(...items.map((item) => distance(item.relativePath)));
    if (best < 1000) {
      const winners = items.filter((item) => distance(item.relativePath) === best).sort((a, b) => naturalCompare(a.relativePath, b.relativePath));
      // A folder whose name carries the era stands for all its files.
      const folders = new Set(winners.map((item) => folderOf(item.relativePath)));
      if (folders.size === 1) {
        const folder = [...folders][0]!;
        if (folder !== category && yearRange(folder.slice(category.length)) !== null) return folder;
      }
      return winners[0]!.relativePath;
    }
  }
  if (!brand || branded.length === 0) return category;
  // Several folders of the brand (tv-globinho, tv-globinho-2003-2009...): the plainest name, so the era-less one wins.
  const folders = [...new Set(items.map((item) => folderOf(item.relativePath)))];
  folders.sort((a, b) => a.length - b.length || naturalCompare(a, b));
  return folders[0]!;
}

/** The bumper categories the generator picks by brand and era. */
const BUMPER_CATEGORIES = ['aberturas', 'encerramentos', 'chamadas', 'intervalos'] as const;

export interface BrandOption {
  /** The word to prefer in the bumpers' path: the brand folder without its years ("tv-globinho"). */
  id: string;
  /** How many bumper files carry it. */
  count: number;
}

/** "tv-globinho-2003-2009" -> "tv-globinho": the folder name without the years of its era. */
function brandOfFolder(folder: string): string {
  const bare = folder.replace(/[\s_-]*\(?(?:19|20)\d\d(?:\s*[-–a_]\s*(?:19|20)\d\d)?\)?\s*$/, '').replace(/[\s_-]+$/, '');
  return bare === '' ? folder : bare;
}

/** The brand folders found in the library's bumpers (vinhetas/aberturas/<marca>/...), as `tv-gominho grade --marca` takes them. */
export function bumperBrands(library: Library): BrandOption[] {
  const found = new Map<string, BrandOption>();
  for (const item of library.interstitials) {
    if (!(BUMPER_CATEGORIES as readonly string[]).includes(item.category)) continue;
    const parts = item.relativePath.split('/');
    if (parts.length < 3) continue;
    const id = brandOfFolder(parts[1]!);
    const entry = found.get(fold(id)) ?? { id, count: 0 };
    entry.count++;
    found.set(fold(id), entry);
  }
  return [...found.values()].sort((a, b) => a.id.localeCompare(b.id, 'pt-BR'));
}

/** The years that appear in the names of the bumpers of the brand ("" = any), as `--epoca` takes them, in order. */
export function bumperEras(library: Library, brand: string): number[] {
  const years = new Set<number>();
  for (const item of library.interstitials) {
    if (!(BUMPER_CATEGORIES as readonly string[]).includes(item.category)) continue;
    if (brand && !fold(item.relativePath).includes(fold(brand))) continue;
    const range = yearRange(item.relativePath.slice(item.category.length));
    if (range) for (const year of range) years.add(year);
  }
  return [...years].sort((a, b) => a - b);
}

/** The `vinhetas_intervalo` brand group (intervalos/<subfolder>) for the brand and era; null = let the engine draw one a day. */
function pickBumperGroup(library: Library, brand: string, era: number | undefined): string | null {
  const ref = pickInterstitialRef(library, 'intervalos', brand, era);
  if (!ref || ref === 'intervalos') return null;
  const group = ref.split('/').slice(0, 2).join('/');
  return resolveInterstitials(library, group).some((item) => item.relativePath.split('/').length > 2) ? group : null;
}

// ---------------------------------------------------------------- YAML

const quote = (text: string) => JSON.stringify(text);

/** "08:00", or "08:00:30" when the time has seconds (a hand-written grade may), so writing it back loses nothing. */
function clock(seconds: number): string {
  return seconds % 60 === 0 ? formatTimeOfDay(seconds) : `${formatTimeOfDay(seconds)}:${String(seconds % 60).padStart(2, '0')}`;
}

/**
 * The schedule as a grade file (docs/grade.md), with the estimated start of each show as a comment. Without the
 * estimates (a grade edited by hand or in the app) the comments are left out.
 */
export function scheduleToYaml(generated: Pick<GeneratedSchedule, 'schedule'> & Partial<GeneratedSchedule>, header: string[] = []): string {
  const { schedule, estimates, itemStarts } = generated;
  const lines = header.map((line) => `# ${line}`);
  if (lines.length > 0) lines.push('');
  lines.push(`nome: ${quote(schedule.name)}`);
  if (schedule.description) lines.push(`descricao: ${quote(schedule.description)}`);
  lines.push(`data_inicio: ${schedule.startDate}`);
  lines.push(`dias: [${schedule.days.join(', ')}]`);
  if (schedule.breakBumpersRef) lines.push(`vinhetas_intervalo: ${quote(schedule.breakBumpersRef)}`);
  if (schedule.adBreaks) {
    const { every, ads, afterEpisode, bumpers } = schedule.adBreaks;
    const rules = [
      every !== undefined ? `a_cada: ${every}` : '',
      ads !== undefined ? `comerciais: ${ads}` : '',
      afterEpisode !== undefined ? `apos_episodio: ${afterEpisode ? 'sim' : 'nao'}` : '',
      bumpers !== undefined ? `vinhetas: ${bumpers ? 'sim' : 'nao'}` : '',
    ].filter(Boolean);
    if (rules.length > 0) lines.push('intervalos:', ...rules.map((rule) => `  ${rule}`));
  }
  lines.push('', 'blocos:');
  schedule.blocks.forEach((block, index) => {
    const estimate = estimates?.[index];
    lines.push(`  - horario: "${clock(block.start)}"${estimate !== undefined ? `   # ~${formatTimeOfDay(block.start + estimate)} no fim, com os intervalos` : ''}`);
    lines.push('    itens:');
    for (const item of block.items) {
      if (item.type === 'show') {
        const at = itemStarts?.get(item);
        // Folder names that YAML could read as something else (a number, "a: b", "#...") are quoted.
        const show = /^[A-Za-z][\w.-]*$/.test(item.show) ? item.show : quote(item.show);
        lines.push(`      - programa: ${show}${at !== undefined ? `   # ~${formatTimeOfDay(at)}` : ''}`);
        if (item.count > 1) lines.push(`        episodios: ${item.count}`);
      } else if (item.type === 'interstitial') {
        lines.push(`      - vinheta: ${quote(item.ref)}`);
      } else {
        lines.push(`      - comerciais: ${item.count}`);
      }
    }
  });
  if (schedule.agenda && schedule.agenda.length > 0) {
    lines.push('', 'agenda:');
    let day: string | undefined;
    for (const pick of schedule.agenda) {
      if (pick.date !== day) {
        lines.push(`  ${quote(pick.date)}:`);
        day = pick.date;
      }
      const item = schedule.blocks.find((block) => block.start === pick.blockStart)?.items[pick.item - 1];
      const show = item?.type === 'show' ? `   # ${item.show}` : '';
      lines.push(`    - bloco: "${clock(pick.blockStart)}"`, `      item: ${pick.item}${show}`, `      episodio: ${/^\d+$/.test(pick.episode) ? pick.episode : quote(pick.episode)}`);
    }
  }
  lines.push(...positionsToYaml(schedule.positions));
  return `${lines.join('\n')}\n`;
}

/** The `posicoes` section of a grade (docs/grade.md), starting with a blank line; no lines when there are no positions. */
export function positionsToYaml(positions: readonly SavedPosition[] | undefined): string[] {
  if (!positions || positions.length === 0) return [];
  const lines = ['', 'posicoes:'];
  let day: string | undefined;
  for (const position of positions) {
    if (position.date !== day) {
      lines.push(`  ${quote(position.date)}:`);
      day = position.date;
    }
    const show = /^[A-Za-z][\w-]*$/.test(position.show) ? position.show : quote(position.show);
    lines.push(`    ${show}: ${/^\d+$/.test(position.episode) ? position.episode : quote(position.episode)}`);
  }
  return lines;
}
