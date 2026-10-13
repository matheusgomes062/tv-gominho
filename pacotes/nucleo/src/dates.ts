// Calendar helpers. Dates are local calendar days written as "YYYY-MM-DD" and
// converted to day numbers (days since 1970-01-01) so DST never shifts them.

export type Weekday = 'dom' | 'seg' | 'ter' | 'qua' | 'qui' | 'sex' | 'sab';

export const WEEKDAYS: readonly Weekday[] = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sab'];

const DAY_MS = 86_400_000;

/** Positive modulo: mod(-1, 7) === 6. */
export function mod(a: number, n: number): number {
  return ((a % n) + n) % n;
}

export function isIsoDate(text: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!m) return false;
  const date = new Date(Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!));
  return date.getUTCMonth() === +m[2]! - 1 && date.getUTCDate() === +m[3]!;
}

export function isoToDayNumber(iso: string): number {
  if (!isIsoDate(iso)) throw new Error(`Invalid date: ${iso}`);
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  return Math.round(Date.UTC(y, m - 1, d) / DAY_MS);
}

export function dayNumberToIso(dayNumber: number): string {
  return new Date(dayNumber * DAY_MS).toISOString().slice(0, 10);
}

export function weekdayOf(dayNumber: number): Weekday {
  // 1970-01-01 was a Thursday.
  return WEEKDAYS[mod(dayNumber + 4, 7)]!;
}

/** The local calendar day of a Date, as "YYYY-MM-DD". */
export function localIsoDate(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function secondsSinceMidnight(date: Date): number {
  return date.getHours() * 3600 + date.getMinutes() * 60 + date.getSeconds() + date.getMilliseconds() / 1000;
}

/**
 * How many days in [from, to) fall on one of `days`.
 * Negative when `to` is before `from`.
 */
export function countDaysInSet(from: number, to: number, days: ReadonlySet<Weekday>): number {
  if (to < from) return -countDaysInSet(to, from, days);
  const span = to - from;
  const weeks = Math.floor(span / 7);
  let count = weeks * days.size;
  for (let day = from + weeks * 7; day < to; day++) {
    if (days.has(weekdayOf(day))) count++;
  }
  return count;
}

/** "08:00" or "08:00:30" -> seconds since midnight, or null if invalid. */
export function parseTimeOfDay(text: string): number | null {
  const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(text.trim());
  if (!m) return null;
  const [h, min, s] = [+m[1]!, +m[2]!, +(m[3] ?? 0)];
  if (h > 23 || min > 59 || s > 59) return null;
  return h * 3600 + min * 60 + s;
}

export function formatTimeOfDay(seconds: number): string {
  const total = Math.floor(mod(seconds, 86_400));
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(Math.floor(total / 3600))}:${pad(Math.floor((total % 3600) / 60))}`;
}
