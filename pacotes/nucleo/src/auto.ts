import { WEEKDAYS } from './dates';
import { generateSchedule } from './generate';
import type { Library, Schedule, ScheduleItem } from './types';

export const AUTO_SCHEDULE_ID = '__automatico';

/**
 * A channel built from whatever is in the library, used when there is no
 * schedule file yet: a TV Globinho-style block (see `generateSchedule`) with
 * every show once, opening and closing bumpers and promos between the shows.
 * What goes inside and after the episodes is up to the commercial breaks.
 */
export function createAutoSchedule(library: Library): Schedule | null {
  if (!library.shows.some((show) => show.episodes.length > 0)) return null;
  const { schedule } = generateSchedule(library, () => undefined, {
    startDate: '2000-01-01',
    days: [...WEEKDAYS],
    blocks: [{ start: 0, length: 0 }],
    oneRound: true,
  });
  return {
    ...schedule,
    id: AUTO_SCHEDULE_ID,
    name: 'Canal Automático',
    description: 'Todos os programas da biblioteca, em sequência.',
  };
}

export const SHOW_CHANNEL_PREFIX = '__programa:';

/**
 * Most episodes in a per-show channel's daily loop. Up to this, the loop holds
 * the whole show; longer series air this many a day and rotate across days.
 */
const MAX_EPISODES_PER_DAY = 40;

/**
 * One channel per show that has playable episodes: the show's episodes back
 * to back (the commercial breaks go between them, no bumpers).
 * In continuous mode the day's loop repeats, so the loop holds every episode;
 * only very long series are split across days.
 * Shows are in library order; the id is stable (`__programa:<folder>`).
 */
export function createShowChannels(library: Library): Schedule[] {
  return library.shows
    .filter((show) => show.episodes.length > 0)
    .map((show) => {
      const count = Math.min(show.episodes.length, MAX_EPISODES_PER_DAY);
      const items: ScheduleItem[] = [];
      for (let i = 0; i < count; i++) {
        items.push({ type: 'show', show: show.id, count: 1 });
      }
      return {
        id: `${SHOW_CHANNEL_PREFIX}${show.id}`,
        path: '',
        name: show.title,
        description: `Só ${show.title}, episódio após episódio.`,
        startDate: '2000-01-01',
        days: [...WEEKDAYS],
        blocks: [{ start: 0, items }],
      };
    });
}
