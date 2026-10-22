// Where focus goes when a screen opened from Menu → Programação closes: back to the row it was opened from.

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
