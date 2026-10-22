import { MAX_REQUEST_LENGTH, proposalToRaw, validateProposal, type Library, type Proposal, type Show } from '@tv-gominho/nucleo';
import { RANGE_PRESETS, initialState, type WizardState } from './wizard-model';

// "Pedir para a IA" in the "Montar a semana" wizard, when the AI has a key and is on (ai-settings-model.ts): what the app
// tells the person before using it, what it sends, and how a proposal becomes the wizard's answers. No DOM or fetch.

export { MAX_REQUEST_LENGTH };

/** Remembers, in this browser, that the person read the notice. */
export const NOTICE_KEY = 'tv-gominho.ia.aviso-lido';

export const NOTICE = {
  sent: 'Saem do computador só os títulos dos programas, quantos episódios cada um tem, as durações típicas, as marcas e anos das vinhetas e o seu pedido. Nunca os vídeos nem os nomes dos arquivos.',
  cost: 'O pedido vai para a Anthropic (Claude) com a sua chave. Cada pedido custa um pouco de dinheiro na conta dessa chave.',
  off: 'Para desligar a IA ou tirar a chave, vá em Configurações, Assistente de IA (com o servidor, no computador que roda o servidor).',
  review: 'A IA só propõe: você vê a prévia e decide se salva, ajusta ou descarta.',
} as const;

export const EXAMPLES = ['Uma manhã de 3 horas com desenhos calmos', 'Sábado e domingo à tarde, só desenhos curtos, sem comerciais', 'Como a TV Globinho de 2004, de segunda a sexta de manhã'];

export type IaReply = { kind: 'proposal'; proposal: Proposal } | { kind: 'needs-pin' } | { kind: 'error'; message: string };

/** What the server's answer means for the app. `body` is the parsed JSON, or null. */
export function iaReply(status: number, body: unknown, library: Library): IaReply {
  if (status === 401 || status === 403) return { kind: 'needs-pin' };
  const data = typeof body === 'object' && body !== null ? (body as { proposta?: unknown; erro?: unknown }) : {};
  if (status !== 200) {
    return { kind: 'error', message: typeof data.erro === 'string' && data.erro ? data.erro : 'Não deu para falar com o computador. Ele ainda está ligado?' };
  }
  return checkProposal(data.proposta, library);
}

/** A proposal from the server, checked again against this app's library (it is what the preview will use). */
export function checkProposal(value: unknown, library: Library): IaReply {
  if (typeof value !== 'object' || value === null) return { kind: 'error', message: 'O computador respondeu sem uma proposta.' };
  const result = validateProposal(proposalToRaw(value as Proposal), library);
  return result.ok ? { kind: 'proposal', proposal: result.proposal } : { kind: 'error', message: result.error };
}

/** Why the request cannot be sent, or null. */
export function requestProblem(text: string): string | null {
  if (text.trim() === '') return 'Escreva o que você quer no canal.';
  if (text.trim().length > MAX_REQUEST_LENGTH) return `Use no máximo ${MAX_REQUEST_LENGTH} letras.`;
  return null;
}

/** The wizard filled with a proposal: always a new channel, so nothing existing is replaced by the AI. */
export function applyProposal(state: WizardState, proposal: Proposal): WizardState {
  const same = (preset: (typeof RANGE_PRESETS)[number]) =>
    preset.id !== 'custom' &&
    preset.ranges.length === proposal.ranges.length &&
    preset.ranges.every((range, i) => range.start === proposal.ranges[i]!.start && range.end === proposal.ranges[i]!.end);
  return {
    ...state,
    preset: RANGE_PRESETS.find(same)?.id ?? 'custom',
    ranges: proposal.ranges.map((range) => ({ ...range })),
    days: [...proposal.days],
    showMode: proposal.shows.length > 0 ? 'pick' : 'all',
    picked: [...proposal.shows],
    adMode: proposal.adBreaks ? 'custom' : 'general',
    ad: proposal.adBreaks ? { ...proposal.adBreaks } : state.ad,
    brand: proposal.brand,
    era: proposal.era,
    name: proposal.name,
    target: null,
    confirmed: false,
  };
}

/** The wizard's answers as a proposal, to send as "what is chosen now"; null while they are still the defaults. */
export function currentChoices(state: WizardState, general: WizardState['ad']): Proposal | null {
  const answers = (value: WizardState) => JSON.stringify({ ...value, target: null, confirmed: false });
  if (answers(state) === answers(initialState(general))) return null;
  return {
    name: state.name.trim().slice(0, 40) || 'Meu canal',
    ranges: [...state.ranges].sort((a, b) => a.start - b.start),
    days: state.days,
    shows: state.showMode === 'pick' ? state.picked : [],
    adBreaks: state.adMode === 'custom' ? state.ad : null,
    brand: state.brand,
    era: state.era,
    note: '',
  };
}

/** The typical length of each show's episodes in whole minutes (median of the durations known), for the shows that have any. */
export function typicalMinutes(shows: readonly Show[], durationOf: (path: string) => number | undefined, sample = 3): Record<string, number> {
  const result: Record<string, number> = {};
  for (const show of shows) {
    const known = show.episodes
      .slice(0, sample)
      .map((episode) => durationOf(episode.path))
      .filter((seconds): seconds is number => seconds !== undefined && Number.isFinite(seconds) && seconds > 0)
      .sort((a, b) => a - b);
    if (known.length > 0) result[show.id] = Math.max(1, Math.round(known[Math.floor(known.length / 2)]! / 60));
  }
  return result;
}
