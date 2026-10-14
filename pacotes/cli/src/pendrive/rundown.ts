// The rundown: what goes into each day of the pendrive. The same engine as the app does the work
// (planDay for the date, buildTimeline with real durations, commercial breaks), in the `do_inicio`
// way: every day starts with its first block, the gaps between blocks are skipped, and the episodes
// advance from one airing day to the next. Planning is pure apart from reading durations, which the
// caller injects, so it is tested without ffmpeg.

import {
  basename,
  buildTimeline,
  isAiringDay,
  nextAiringDate,
  planDay,
  requiredPaths,
  stripExtension,
  type AdBreakSettings,
  type DayPlan,
  type Library,
  type Schedule,
  type Timeline,
  type TimelineEntry,
} from '@tv-chuvisco/nucleo';

export interface RundownSettings {
  /** Play bumpers (vinhetas), also as gap fillers. */
  interstitials: boolean;
  /** Play commercials, also as gap fillers and in the breaks. */
  commercials: boolean;
  adBreaks: AdBreakSettings;
}

/** Where durations come from (ffprobe in the command, a table in the tests). */
export interface DurationSource {
  /** Makes the durations of these library paths available to `get`. */
  load(paths: string[]): Promise<void>;
  /** Seconds, or undefined for an unreadable file. */
  get(path: string): number | undefined;
}

/**
 * The first `count` airing days from `from` (that day itself if the schedule airs on it, otherwise the
 * next one that does). Days off are skipped: they would only repeat the last day.
 */
export function airingDates(schedule: Schedule, from: string, count: number): string[] {
  const dates: string[] = [];
  let date = isAiringDay(schedule, from) ? from : nextAiringDate(schedule, from);
  for (let i = 0; i < count; i++) {
    dates.push(date);
    date = nextAiringDate(schedule, date);
  }
  return dates;
}

export interface DayTimeline {
  date: string;
  plan: DayPlan;
  timeline: Timeline;
}

/** Plans each date and lays it out with the real durations: marathon style, no gaps, with the commercial breaks. */
export async function planTimelines(
  schedule: Schedule,
  library: Library,
  dates: readonly string[],
  settings: RundownSettings,
  durations: DurationSource,
  onDay?: (date: string, index: number) => void,
): Promise<DayTimeline[]> {
  const days: DayTimeline[] = [];
  for (const [index, date] of dates.entries()) {
    onDay?.(date, index);
    const plan = planDay(schedule, library, date, { interstitials: settings.interstitials, commercials: settings.commercials });
    await durations.load(requiredPaths(plan));
    // Same options as the app's `horario: do_inicio` (TvMode.tsx): maxGapFill 0 skips every gap.
    const timeline = buildTimeline(plan, durations.get, { maxGapFill: 0, adBreaks: settings.adBreaks });
    days.push({ date, plan, timeline });
  }
  return days;
}

/** What a piece of the rundown is. */
export type PieceRole = 'episodio' | 'vinheta' | 'comercial';

/** One video to render: a whole file or a stretch of one (an episode act between two breaks). */
export interface Piece {
  /** Library path of the source file. */
  path: string;
  role: PieceRole;
  /** For the console: "Show: Episode", or the file name of a bumper/commercial. */
  title: string;
  /** First frame (at the job's frame rate) of the source file this piece starts at. */
  startFrame: number;
  frames: number;
  /** frames / fps. */
  seconds: number;
  /** Seconds from the start of the day to the start of this piece. */
  offset: number;
  /** One of the commercials of a commercial break. */
  inBreak: boolean;
  /** This piece is act `index` of `count` of an episode cut by commercial breaks. */
  act?: { index: number; count: number };
}

export interface RundownDay {
  /** 1-based, in the order of the pendrive. */
  number: number;
  date: string;
  pieces: Piece[];
  seconds: number;
}

export interface Rundown {
  fps: number;
  days: RundownDay[];
  /** Library paths left out because their duration is unknown (unreadable files). */
  skipped: string[];
}

function roleOf(entry: TimelineEntry): PieceRole {
  if (entry.kind === 'episode') return 'episodio';
  const category = entry.item?.kind === 'interstitial' ? entry.item.category : undefined;
  const commercial = entry.inBreak || category === 'comerciais' || /(^|\/)vinhetas\/comerciais\//i.test(entry.path ?? '');
  return commercial ? 'comercial' : 'vinheta';
}

function titleOf(entry: TimelineEntry): string {
  const item = entry.item;
  if (item?.kind === 'episode') return `${item.show.title}: ${item.episode.title}`;
  return stripExtension(basename(entry.path ?? ''));
}

/** Turns timelines into pieces aligned to whole frames of `fps`. Idle gaps have nothing to render and are dropped. */
export function buildRundown(days: readonly DayTimeline[], fps: number): Rundown {
  const skipped = new Set<string>();
  const result: RundownDay[] = days.map(({ date, timeline }, index) => {
    for (const path of timeline.skipped) skipped.add(path);
    const pieces: Piece[] = [];
    let offset = 0;
    for (const entry of timeline.entries) {
      if (entry.path === undefined || entry.kind === 'idle') continue;
      // Both ends are rounded to whole frames, so consecutive acts of one episode join without a gap or an overlap.
      const startFrame = Math.round((entry.fileOffset ?? 0) * fps);
      const endFrame = Math.round(((entry.fileOffset ?? 0) + entry.duration) * fps);
      const frames = endFrame - startFrame;
      if (frames < 1) continue;
      const piece: Piece = {
        path: entry.path,
        role: roleOf(entry),
        title: titleOf(entry),
        startFrame,
        frames,
        seconds: frames / fps,
        offset,
        inBreak: Boolean(entry.inBreak),
      };
      if (entry.part) piece.act = entry.part;
      pieces.push(piece);
      offset += piece.seconds;
    }
    return { number: index + 1, date, pieces, seconds: offset };
  });
  return { fps, days: result, skipped: [...skipped] };
}

/** The frame rate of the job: 25 or 30, whichever most of the (time-weighted) sources are closest to. */
export function chooseFps(sources: readonly { fps: number | null; seconds: number }[]): 25 | 30 {
  let pal = 0;
  let ntsc = 0;
  for (const { fps: raw, seconds } of sources) {
    if (raw === null || !(raw > 0) || !(seconds > 0)) continue;
    // 50 and 60 fields/frames per second halve cleanly to 25 and 30.
    const fps = raw > 40 ? raw / 2 : raw;
    if (Math.abs(fps - 25) < Math.abs(fps - 30)) pal += seconds;
    else ntsc += seconds;
  }
  return pal > ntsc ? 25 : 30;
}

/** Every distinct library path the rundown reads. */
export function rundownPaths(rundown: Rundown): string[] {
  return [...new Set(rundown.days.flatMap((day) => day.pieces.map((piece) => piece.path)))];
}
