// Saving through `tv-gominho servir --editar`: the PIN typed on the TV and what the server's answers
// mean for the app. No DOM, no fetch: the server source (sources/server.ts) and the wizard use these.

/** Digits of the PIN the server shows in the terminal. */
export const PIN_LENGTH = 6;

export type PairOutcome = 'paired' | 'wrong' | 'locked' | 'failed';
export type WriteOutcome = 'written' | 'needs-pin' | 'exists' | 'failed';

/** The PIN after a key: a digit is added (up to PIN_LENGTH), 'delete' takes the last one off. */
export function typePin(pin: string, key: string): string {
  if (key === 'delete') return pin.slice(0, -1);
  if (/^\d$/.test(key) && pin.length < PIN_LENGTH) return pin + key;
  return pin;
}

export function pinComplete(pin: string): boolean {
  return pin.length === PIN_LENGTH && /^\d+$/.test(pin);
}

export function pairOutcome(status: number): PairOutcome {
  if (status === 200) return 'paired';
  if (status === 403) return 'wrong';
  if (status === 429) return 'locked';
  return 'failed';
}

/** 401 (no session) and 403 (session gone, e.g. the server restarted): the device pairs again. */
export function writeOutcome(status: number): WriteOutcome {
  if (status === 200 || status === 201) return 'written';
  if (status === 401 || status === 403) return 'needs-pin';
  if (status === 409) return 'exists';
  return 'failed';
}

export const PAIR_MESSAGES: Record<Exclude<PairOutcome, 'paired'>, string> = {
  wrong: 'PIN errado. Confira o número que aparece no computador.',
  locked: 'Muitas tentativas erradas. Espere um pouco e tente de novo.',
  failed: 'Não deu para falar com o computador. Ele ainda está ligado?',
};
