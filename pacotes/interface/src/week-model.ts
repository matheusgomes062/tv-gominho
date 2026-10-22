import { blockedEpisodes, formatTimeOfDay, isAiringDay, previewDay, type DayPreview, type Library, type PreviewOptions, type PreviewWarning, type Schedule, type Show } from '@tv-gominho/nucleo';
import { episodeLabel } from './agenda-model';
import { dayLabel } from './wizard-model';

// The week of a channel as the screens show it: for each day, what airs and at what time. The one model behind the
// preview of the wizard and the week of "Mudar uma programação", so both say the same times. The times and the
// episodes come from `previewDay` (the TV engine: planDay + buildTimeline with the channel's break rules). No React
// or DOM in here, so it is all testable (see week-model.test.ts); WeekView.tsx only draws it.

/** One episode on the air, at the clock time a viewer would see it start. */
export interface Airing {
  /** Unique in the week. */
  key: string;
  date: string;
  /** Seconds since midnight. */
  start: number;
  /** "08:21". */
  time: string;
  /** Seconds since midnight when its last part ends (the breaks inside it count): the guide draws it from `start` to here. */
  end: number;
  showId: string;
  showTitle: string;
  episodeIndex: number;
  /** "Ep. 12", or "#3" for an episode without a number in its file name. */
  label: string;
  /** The title of the episode (may be empty). */
  title: string;
  /** The "não passar" list holds it: it airs only because an episode was picked. */
  blocked: boolean;
  /** The episode was picked by hand for this day (the first one of the item). */
  pinned: boolean;
  /** The editor item that plays it, when the screen can pick from the week (see `WeekOptions.itemKeyAt`). */
  itemKey?: number;
  /** A pick can be made here: from today on, from the premiere of the channel, and the item is known. */
  editable: boolean;
}

export interface WeekDay {
  date: string;
  /** "Qua 22/10". */
  label: string;
  today: boolean;
  /** False on a day off the channel's `dias`. */
  airs: boolean;
  /** The channel starts after this day. */
  beforeStart: boolean;
  airings: Airing[];
  /** What the engine said about the day: the day view of the wizard lists the blocks and the lengths from it. */
  preview: DayPreview;
}

export interface WeekWarning {
  kind: PreviewWarning['kind'];
  message: string;
  /** The labels of the days it applies to. */
  days: string[];
}

export interface WeekModel {
  days: WeekDay[];
  /** One entry per message, with the days it applies to. */
  warnings: WeekWarning[];
  /** Some video's duration was not known: the times are guesses. */
  estimated: boolean;
  /** Every file whose duration the layout needs: load these, then build the week again. */
  paths: string[];
}

export interface WeekOptions extends PreviewOptions {
  /** "YYYY-MM-DD": earlier days cannot be picked. Without it nothing is editable. */
  today?: string;
  /** The editor item behind the item at `block` and `item` (both from 0) of the schedule; what makes an airing pickable. */
  itemKeyAt?(block: number, item: number): number | undefined;
}

/** "Ep. 12"; an episode with no number in its file name is told by its place in the show ("#3"). */
export function airingLabel(number: number | null, season: string | null, index: number): string {
  return number === null ? `#${index + 1}` : episodeLabel({ number, season });
}

/** The week over `dates` ("YYYY-MM-DD", in order): what airs on each, at what time. */
export function buildWeekModel(schedule: Schedule, library: Library, dates: readonly string[], options: WeekOptions): WeekModel {
  const blockedOf = new Map<string, ReadonlySet<number>>();
  const blocked = (show: Show, episodeIndex: number) => {
    if (!blockedOf.has(show.id)) blockedOf.set(show.id, blockedEpisodes(library, show));
    return blockedOf.get(show.id)!.has(episodeIndex);
  };

  const warned = new Map<string, WeekWarning>();
  const paths = new Set<string>();
  let estimated = false;

  const days = dates.map((date): WeekDay => {
    const beforeStart = date < schedule.startDate;
    const preview = beforeStart
      ? ({ date, airs: false, rows: [], blocks: [], warnings: [], estimated: false, paths: [] } satisfies DayPreview)
      : previewDay(schedule, library, date, options);
    const label = dayLabel(date);
    estimated ||= preview.estimated;
    for (const path of preview.paths) paths.add(path);
    for (const warning of preview.warnings) {
      const entry = warned.get(warning.message) ?? { kind: warning.kind, message: warning.message, days: [] };
      warned.set(warning.message, { ...entry, days: [...entry.days, label] });
    }

    // A pick pins the first episode its item plays that day.
    const seen = new Set<string>();
    const airings = preview.rows.map((row): Airing => {
      const place = `${row.block}|${row.item}`;
      const first = !seen.has(place);
      seen.add(place);
      const blockStart = schedule.blocks[row.block]?.start;
      const itemKey = options.itemKeyAt?.(row.block, row.item);
      return {
        key: `${date}|${row.start}|${row.episodeIndex}`,
        date,
        start: row.start,
        time: formatTimeOfDay(row.start),
        end: row.end,
        showId: row.show.id,
        showTitle: row.show.title,
        episodeIndex: row.episodeIndex,
        label: airingLabel(row.episode.number, row.episode.season, row.episodeIndex),
        title: row.episode.title,
        blocked: blocked(row.show, row.episodeIndex),
        pinned: first && (schedule.agenda ?? []).some((pick) => pick.date === date && pick.blockStart === blockStart && pick.item === row.item + 1),
        ...(itemKey !== undefined ? { itemKey } : {}),
        editable: itemKey !== undefined && options.today !== undefined && date >= options.today,
      };
    });
    return { date, label, today: date === options.today, airs: isAiringDay(schedule, date), beforeStart, airings, preview };
  });

  return { days, warnings: [...warned.values()], estimated, paths: [...paths] };
}
