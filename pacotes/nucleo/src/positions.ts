// Saved positions (`posicoes` in the grade, docs/grade.md): when a channel is edited, the app records where each
// show stood, so that changing the blocks does not make episodes jump back or skip. The engine reads them as anchors
// (see agenda.ts); this file only works out what to write.

import { dayNumberToIso, isoToDayNumber, weekdayOf, type Weekday } from './dates';
import { planDay, scheduleDays } from './engine';
import { findShow } from './library';
import type { Library, SavedPosition, Schedule, Show } from './types';

/**
 * `newSchedule` (an edit of `oldSchedule`) with the position every show of it had in `oldSchedule` on `date`
 * ("YYYY-MM-DD"): the episode `oldSchedule` airs first that day, which is where the show goes on in the new blocks.
 * Whatever the engine decides for the old one counts, so an agenda pick, an earlier position or the "não passar" list is respected.
 * `oldLibrary` is the library `oldSchedule` aired with: pass it when the list changed along with the edit (the grade
 * may even be the same), otherwise `library` serves for both. In the new library a blocked position moves on to the
 * next allowed episode.
 *
 * - A day the old (or new) schedule does not air counts as the next day it does.
 * - Shows only in `newSchedule` get no position, and neither do shows that draw their episodes (`ordem: aleatoria`).
 * - The agenda and the later positions of `newSchedule` stay. Its earlier positions of a recorded show are dropped:
 *   from `date` on the new one decides, so they changed nothing that airs from then on, and the file stays small
 *   (the days before `date` are counted again with the new blocks anyway). A position on `date` itself is replaced.
 * - Same inputs, same output; neither schedule is changed.
 */
export function preservePositions(oldSchedule: Schedule, newSchedule: Schedule, library: Library, date: string, oldLibrary: Library = library): Schedule {
  const oldDay = nextAiringDay(scheduleDays(oldSchedule), date);
  const newDay = nextAiringDay(scheduleDays(newSchedule), date);

  const plan = planDay(oldSchedule, oldLibrary, oldDay);
  const firstEpisode = new Map<string, number>();
  for (const block of plan.blocks) {
    for (const item of block.items) {
      if (item.kind === 'episode' && !firstEpisode.has(item.show.id.toLowerCase())) firstEpisode.set(item.show.id.toLowerCase(), item.episodeIndex);
    }
  }

  const recorded: SavedPosition[] = [];
  for (const name of showsOf(newSchedule)) {
    const show = findShow(library, name);
    const oldShow = findShow(oldLibrary, name);
    const index = firstEpisode.get(name.toLowerCase());
    if (!show || !oldShow || show.order === 'aleatoria' || index === undefined) continue;
    const episode = episodeRef(oldShow, index);
    if (episode !== null) recorded.push({ date: newDay, show: name, episode });
  }

  const replaced = new Set(recorded.map((position) => position.show.toLowerCase()));
  const kept = (newSchedule.positions ?? []).filter((position) => !replaced.has(position.show.toLowerCase()) || position.date > newDay);
  const positions = [...kept, ...recorded].sort((a, b) => a.date.localeCompare(b.date) || a.show.localeCompare(b.show));

  const { positions: _before, ...rest } = newSchedule;
  return positions.length > 0 ? { ...rest, positions } : rest;
}

/** The first airing day of the schedule on or after `date`. */
function nextAiringDay(days: ReadonlySet<Weekday>, date: string): string {
  let day = isoToDayNumber(date);
  while (!days.has(weekdayOf(day))) day++;
  return dayNumberToIso(day);
}

/** The shows of the schedule, as written, once each and in the order they first appear. */
function showsOf(schedule: Schedule): string[] {
  const seen = new Map<string, string>();
  for (const block of schedule.blocks) {
    for (const item of block.items) if (item.type === 'show' && !seen.has(item.show.toLowerCase())) seen.set(item.show.toLowerCase(), item.show);
  }
  return [...seen.values()];
}

/** The reference (agenda.ts `findEpisodeByRef`) of `show.episodes[index]`: its number, with the season when the number repeats. Null for an episode without a number. */
function episodeRef(show: Show, index: number): string | null {
  const episode = show.episodes[index];
  if (!episode || episode.number === null) return null;
  const repeats = show.episodes.some((other, i) => i !== index && other.number === episode.number);
  if (!repeats) return String(episode.number);
  return episode.season ? `${episode.season}/${episode.number}` : null;
}
