// Builds a TV Globinho-style schedule from what is in the library: each block opens
// with an opening bumper, runs the shows in turn with promos between them and
// closes with a closing bumper, filling the time asked for (breaks included).

import { WEEKDAYS, formatTimeOfDay, type Weekday } from './dates';
import { resolveInterstitials } from './library';
import { fold, naturalCompare } from './paths';
import { hashString } from './random';
import type { AdBreakSettings } from './settings';
import type { Library, Schedule, ScheduleBlock, ScheduleItem, Show } from './types';

export interface GenerateBlock {
  /** Seconds since midnight. */
  start: number;
  /** Air time to fill, breaks included, in seconds. */
  length: number;
}

export interface GenerateOptions {
  /** Channel name. Default "TV Globinho". */
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
}

export interface GeneratedSchedule {
  schedule: Schedule;
  /** Estimated air time of each block, breaks included, in seconds. */
  estimates: number[];
  /** Estimated start of each show item, in seconds since midnight, by block and item index. */
  itemStarts: Map<ScheduleItem, number>;
}

/** When nothing is known about a file. */
const GUESS = { episode: 22 * 60, commercial: 30, bumper: 8, promo: 20 } as const;
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

  const settings = library.settings;
  const adBreaks: AdBreakSettings | null = settings.commercials && resolveInterstitials(library, 'comerciais').length > 0 ? settings.adBreaks : null;
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
    id: 'tv-globinho',
    path: '',
    name: options.name ?? 'TV Globinho',
    description: options.description,
    startDate: options.startDate,
    days: options.days ?? WEEKDAYS.filter((day) => day !== 'sab' && day !== 'dom'),
    blocks,
    ...(bumpers ? { breakBumpersRef: bumpers } : {}),
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

/** The `vinhetas_intervalo` brand group (intervalos/<subfolder>) for the brand and era; null = let the engine draw one a day. */
function pickBumperGroup(library: Library, brand: string, era: number | undefined): string | null {
  const ref = pickInterstitialRef(library, 'intervalos', brand, era);
  if (!ref || ref === 'intervalos') return null;
  const group = ref.split('/').slice(0, 2).join('/');
  return resolveInterstitials(library, group).some((item) => item.relativePath.split('/').length > 2) ? group : null;
}

// ---------------------------------------------------------------- YAML

const quote = (text: string) => JSON.stringify(text);

/** The schedule as a grade file (docs/grade.md), with the estimated start of each show as a comment. */
export function scheduleToYaml(generated: GeneratedSchedule, header: string[] = []): string {
  const { schedule, estimates, itemStarts } = generated;
  const lines = header.map((line) => `# ${line}`);
  if (lines.length > 0) lines.push('');
  lines.push(`nome: ${quote(schedule.name)}`);
  if (schedule.description) lines.push(`descricao: ${quote(schedule.description)}`);
  lines.push(`data_inicio: ${schedule.startDate}`);
  lines.push(`dias: [${schedule.days.join(', ')}]`);
  if (schedule.breakBumpersRef) lines.push(`vinhetas_intervalo: ${quote(schedule.breakBumpersRef)}`);
  lines.push('', 'blocos:');
  schedule.blocks.forEach((block, index) => {
    lines.push(`  - horario: "${formatTimeOfDay(block.start)}"   # ~${formatTimeOfDay(block.start + estimates[index]!)} no fim, com os intervalos`);
    lines.push('    itens:');
    for (const item of block.items) {
      if (item.type === 'show') {
        const at = itemStarts.get(item);
        lines.push(`      - programa: ${item.show}${at !== undefined ? `   # ~${formatTimeOfDay(at)}` : ''}`);
        if (item.count > 1) lines.push(`        episodios: ${item.count}`);
      } else if (item.type === 'interstitial') {
        lines.push(`      - vinheta: ${quote(item.ref)}`);
      } else {
        lines.push(`      - comerciais: ${item.count}`);
      }
    }
  });
  return `${lines.join('\n')}\n`;
}
