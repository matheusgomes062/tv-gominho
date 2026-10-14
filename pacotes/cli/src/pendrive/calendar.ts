// Small date helpers for the command line ("YYYY-MM-DD" local calendar days).

const WEEKDAY_NAMES = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];

/** True for a real calendar date written as YYYY-MM-DD. */
export function isIsoDate(text: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!match) return false;
  const date = new Date(Date.UTC(+match[1]!, +match[2]! - 1, +match[3]!));
  return date.getUTCMonth() === +match[2]! - 1 && date.getUTCDate() === +match[3]!;
}

/** "segunda-feira" for 2026-10-12. */
export function weekdayName(iso: string): string {
  const [year, month, day] = iso.split('-').map(Number) as [number, number, number];
  return WEEKDAY_NAMES[new Date(Date.UTC(year, month - 1, day)).getUTCDay()]!;
}

/** "12/10/2026". */
export function formatDate(iso: string): string {
  const [year, month, day] = iso.split('-');
  return `${day}/${month}/${year}`;
}
