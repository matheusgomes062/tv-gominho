import { WEEKDAYS } from './dates';
import { resolveInterstitials } from './library';
import type { Library, Schedule, ScheduleItem } from './types';

export const AUTO_SCHEDULE_ID = '__automatico';

/**
 * A channel built from whatever is in the library, used when there is no
 * schedule file yet: opening, then one episode of each show with bumpers in
 * between, then the closing.
 */
export function createAutoSchedule(library: Library): Schedule | null {
  if (library.shows.length === 0) return null;
  const has = (category: string) => resolveInterstitials(library, category).length > 0;

  const items: ScheduleItem[] = [];
  if (has('aberturas')) items.push({ type: 'interstitial', ref: 'aberturas' });
  library.shows.forEach((show, i) => {
    if (i > 0 && has('intervalos')) items.push({ type: 'interstitial', ref: 'intervalos' });
    items.push({ type: 'show', show: show.id, count: 1 });
  });
  if (has('encerramentos')) items.push({ type: 'interstitial', ref: 'encerramentos' });

  return {
    id: AUTO_SCHEDULE_ID,
    path: '',
    name: 'Canal Automático',
    description: 'Todos os programas da biblioteca, em sequência.',
    startDate: '2000-01-01',
    days: [...WEEKDAYS],
    blocks: [{ start: 0, items }],
  };
}
