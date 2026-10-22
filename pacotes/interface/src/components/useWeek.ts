import type { Library, Schedule } from '@tv-gominho/nucleo';
import { useEffect, useMemo, useState } from 'react';
import type { Durations } from '../media';
import { useSettings } from '../settings';
import { buildWeekModel, type WeekModel, type WeekOptions } from '../week-model';

/**
 * The week of a channel (week-model.ts) for a screen: laid out at once with typical durations, then again when the
 * real durations of the videos it airs have been read. `reading` is true while they are being read.
 */
export function useWeek(
  schedule: Schedule | null | undefined,
  library: Library,
  dates: readonly string[],
  durations: Durations,
  extra: Pick<WeekOptions, 'today' | 'itemKeyAt'> = {},
): { week: WeekModel | null; reading: boolean } {
  const { settings } = useSettings();
  // Bumps when the durations of the videos have been read: `durations.get` answers differently now.
  const [loaded, setLoaded] = useState(0);
  const [reading, setReading] = useState(false);
  const { today, itemKeyAt } = extra;

  const week = useMemo(
    () => (schedule ? buildWeekModel(schedule, library, dates, { settings, durationOf: durations.get, today, itemKeyAt }) : null),
    // `loaded` stands for "durations.get answers differently now".
    [schedule, library, settings, dates, durations, today, itemKeyAt, loaded],
  );

  // Read the durations of what the week airs (the plan of each day decides which files), then lay it out again.
  useEffect(() => {
    if (!schedule) return;
    const paths = buildWeekModel(schedule, library, dates, { settings, durationOf: durations.get }).paths;
    let current = true;
    setReading(true);
    durations.load(paths).finally(() => {
      if (!current) return;
      setReading(false);
      setLoaded((count) => count + 1);
    });
    return () => {
      current = false;
    };
  }, [schedule, library, settings, dates, durations]);

  return { week, reading };
}
