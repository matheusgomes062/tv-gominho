// The "Voltar = Menu" hint on the TV picture: shown on the first launch and again when nobody touches the TV for a while.

const KEY = 'tv-gominho.dica-menu';

/** How long the hint stays on screen each time. */
export const HINT_MS = 8000;
/** How long without any input before the hint comes back. */
export const IDLE_HINT_MS = 5 * 60 * 1000;

type Store = Pick<Storage, 'getItem' | 'setItem'>;

function defaultStore(): Store | null {
  try {
    return localStorage;
  } catch {
    return null;
  }
}

/** True when the hint was already shown once. Blocked storage counts as "not seen" (the hint shows each launch). */
export function hintSeen(store: Store | null = defaultStore()): boolean {
  try {
    return store?.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

export function markHintSeen(store: Store | null = defaultStore()): void {
  try {
    store?.setItem(KEY, '1');
  } catch {
    // Storage blocked: the hint just shows again next time.
  }
}
