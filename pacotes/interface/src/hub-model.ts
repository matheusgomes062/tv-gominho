import { formatTimeOfDay, type Schedule, type Weekday } from '@tv-gominho/nucleo';
import { DAY_ORDER } from './wizard-model';

// Where focus goes when a screen opened from Menu → Programação closes: back to the row it was opened from.
// Also the words of a channel row and of the pairing status of that screen.

/** The row of the schedule screen that opened a sub-screen. */
export type HubTarget = { kind: 'wizard' } | { kind: 'blocklist' } | { kind: 'edit'; id: string };

/** The target if it still exists (an edited channel may be gone after a save); the first row otherwise. */
export function resolveHubTarget(target: HubTarget | null, channelIds: string[]): HubTarget {
  if (!target) return { kind: 'wizard' };
  if (target.kind === 'edit' && !channelIds.includes(target.id)) return { kind: 'wizard' };
  return target;
}

export function sameHubTarget(a: HubTarget, b: HubTarget): boolean {
  return a.kind === b.kind && (a.kind !== 'edit' || a.id === (b as { id: string }).id);
}

// ---------------------------------------------------------------- the rows of the channels

const SHORT_DAY: Record<Weekday, string> = { dom: 'dom', seg: 'seg', ter: 'ter', qua: 'qua', qui: 'qui', sex: 'sex', sab: 'sáb' };

/** The days of the week in few words: "Seg a sex", "Sáb e dom", "Seg, qua e sex", "Todos os dias". */
export function shortDays(days: readonly Weekday[]): string {
  const on = DAY_ORDER.filter((day) => days.includes(day));
  if (on.length === 0) return 'Nenhum dia';
  if (on.length === DAY_ORDER.length) return 'Todos os dias';
  const runs: Weekday[][] = [];
  for (const day of on) {
    const last = runs.at(-1);
    if (last && DAY_ORDER.indexOf(last.at(-1)!) + 1 === DAY_ORDER.indexOf(day)) last.push(day);
    else runs.push([day]);
  }
  const parts = runs.map((run) => (run.length >= 3 ? `${SHORT_DAY[run[0]!]} a ${SHORT_DAY[run.at(-1)!]}` : run.map((day) => SHORT_DAY[day]).join(' e ')));
  const text = parts.length > 1 ? `${parts.slice(0, -1).join(', ')} e ${parts.at(-1)}` : parts[0]!;
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** "Seg a sex · 08:00–12:00 · 7 desenhos": when a channel airs (first to last block) and how many different shows it takes turns with. */
export function channelSummary(schedule: Pick<Schedule, 'days' | 'blocks'>): string {
  const starts = schedule.blocks.map((block) => block.start).sort((a, b) => a - b);
  const times = starts.length === 0 ? 'sem horários' : starts.length === 1 ? formatTimeOfDay(starts[0]!) : `${formatTimeOfDay(starts[0]!)}–${formatTimeOfDay(starts.at(-1)!)}`;
  const shows = new Set<string>();
  for (const block of schedule.blocks) for (const item of block.items) if (item.type === 'show') shows.add(item.show);
  const count = shows.size === 0 ? 'sem desenhos' : `${shows.size} ${shows.size === 1 ? 'desenho' : 'desenhos'}`;
  return [shortDays(schedule.days), times, count].join(' · ');
}

// ---------------------------------------------------------------- pairing (servir --editar)

/** The small status in the header of the schedule screen: null unless the library is served with --editar and the state is known. */
export function pairingBadge(editing: boolean, paired: boolean | null): { label: string; ok: boolean } | null {
  if (!editing || paired === null) return null;
  return paired ? { label: 'Pareado', ok: true } : { label: 'Falta o PIN', ok: false };
}
