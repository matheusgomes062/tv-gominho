import type { Weekday } from './dates';
import type { PartialSettings, Settings } from './settings';

/**
 * Where the library files come from: a folder picked in the browser, the Node
 * file system, a USB stick on Android... Paths are relative to the folder the
 * user picked and always use '/' separators.
 */
export interface LibrarySource {
  files: readonly string[];
  readText(path: string): Promise<string>;
}

export interface Episode {
  path: string;
  number: number | null;
  title: string;
  description?: string;
  /** Season folder (e.g. "temporada-01"), or null when there are no seasons. */
  season: string | null;
  /**
   * Exact commercial-break cut points inside the episode, in seconds from its
   * start, ascending (`intervalos` in episodios.yaml). Absent: the engine places
   * the breaks itself.
   */
  breaks?: number[];
}

export interface Show {
  /** Folder name, used to reference the show in schedules. */
  id: string;
  title: string;
  originalTitle?: string;
  year?: number;
  description?: string;
  rating?: string;
  order: 'sequencial' | 'aleatoria';
  poster?: string;
  backdrop?: string;
  logo?: string;
  episodes: Episode[];
}

export interface Interstitial {
  path: string;
  /** First folder under vinhetas/, lowercased: "aberturas", "intervalos"... */
  category: string;
  /** Path relative to vinhetas/, e.g. "aberturas/2003/abertura.mp4". */
  relativePath: string;
}

export type ScheduleItem =
  | { type: 'show'; show: string; count: number }
  /** "aberturas", "aberturas/2003" or "aberturas/2003/abertura.mp4" */
  | { type: 'interstitial'; ref: string }
  | { type: 'commercials'; count: number };

export interface ScheduleBlock {
  /** Seconds since midnight. */
  start: number;
  items: ScheduleItem[];
}

/**
 * An episode picked by hand for a date (`agenda` in the grade file). `item` is the 1-based position among
 * the block's items, which must be a show.
 */
export interface AgendaPick {
  /** "YYYY-MM-DD": an airing day of the schedule. */
  date: string;
  /** `ScheduleBlock.start` of the block. */
  blockStart: number;
  item: number;
  /** The number in the episode's file name ("12"), or "temporada-02/12" when seasons repeat numbers. */
  episode: string;
}

export interface Schedule {
  /** File name without extension; also the channel identifier. */
  id: string;
  path: string;
  name: string;
  description?: string;
  /** "YYYY-MM-DD": the day the schedule premiered. Drives episode progression. */
  startDate: string;
  days: Weekday[];
  blocks: ScheduleBlock[];
  /**
   * `vinhetas_intervalo`: which bumpers frame the commercial breaks, as a reference like a `vinheta` item
   * ("intervalos/tv-globinho"). Absent: the engine draws one brand from vinhetas/intervalos/ for each day.
   */
  breakBumpersRef?: string;
  /** Episodes picked by hand for a date, in date order. Absent: every episode follows the count from `startDate`. */
  agenda?: AgendaPick[];
}

export interface LibraryWarning {
  path?: string;
  message: string;
}

export interface Library {
  /** Prefix of the library inside the picked folder: "" or e.g. "biblioteca/". */
  root: string;
  shows: Show[];
  interstitials: Interstitial[];
  schedules: Schedule[];
  /** DEFAULT_SETTINGS with the library's configuracoes.yaml on top. */
  settings: Settings;
  /** Only what configuracoes.yaml sets (empty when there is no file). */
  settingsFile: PartialSettings;
  warnings: LibraryWarning[];
}
