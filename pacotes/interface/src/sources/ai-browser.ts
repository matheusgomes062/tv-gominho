import {
  ANTHROPIC_MODEL,
  ANTHROPIC_URL,
  anthropicAnswer,
  anthropicRequest,
  anthropicStatusFailure,
  apiKeyProblem,
  buildProposalPrompt,
  keyEnding,
  parseProposal,
  proposalSchema,
  validateProposal,
  type Library,
} from '@tv-gominho/nucleo';
import { requestProblem } from '../ia-model';
import type { AiBackend, AiChange, AiStatus, IaRequest } from './types';

// The AI assistant when the app is opened on a folder, with no server: the person's key is kept in this browser
// only (localStorage of this site) and the browser calls the Anthropic API itself, with the header that allows it.
// The prompt, the schema and the checks are the server's own (nucleo). No message ever carries the key.

export const KEY_ITEM = 'tv-gominho.ia.chave';
export const ENABLED_ITEM = 'tv-gominho.ia.ligada';
/** At least this long between two requests: each one costs money. */
export const BROWSER_INTERVAL_MS = 5_000;
const TIMEOUT_MS = 90_000;

/** The part of localStorage used here; reads and writes can throw (private window, blocked site data). */
export type KeyStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export interface BrowserAiOptions {
  storage?: KeyStorage | null;
  fetch?: typeof fetch;
  now?(): number;
  timeoutMs?: number;
  /** The page's address scheme, for tests. Default: location.protocol. */
  protocol?: string;
}

const STORAGE_FAILED = 'Este navegador não deixou guardar a chave (janela anônima ou dados do site bloqueados).';

function defaultStorage(): KeyStorage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

export function browserAi(options: BrowserAiOptions = {}): AiBackend {
  const storage = options.storage === undefined ? defaultStorage() : options.storage;
  const send = options.fetch ?? ((...args: Parameters<typeof fetch>) => fetch(...args));
  const now = options.now ?? Date.now;
  const fileOrigin = (options.protocol ?? (typeof location === 'undefined' ? '' : location.protocol)) === 'file:';
  let last = -Infinity;
  let busy = false;

  const read = (item: string): string | null => {
    try {
      return storage?.getItem(item) ?? null;
    } catch {
      return null;
    }
  };
  const write = (item: string, value: string | null): boolean => {
    try {
      if (!storage) return false;
      if (value === null) storage.removeItem(item);
      else storage.setItem(item, value);
      return true;
    } catch {
      return false;
    }
  };
  const key = () => {
    const value = read(KEY_ITEM);
    return value !== null && apiKeyProblem(value) === null ? value.trim() : undefined;
  };

  function status(): AiStatus {
    const saved = key();
    const enabled = read(ENABLED_ITEM) === '1';
    return {
      place: 'browser',
      key: saved ? 'saved' : 'none',
      ...(saved ? { ending: keyEnding(saved) } : {}),
      enabled,
      available: enabled && saved !== undefined,
      canManage: storage !== null,
      model: ANTHROPIC_MODEL,
      ...(fileOrigin ? { fileOrigin } : {}),
    };
  }
  const changed = (ok: boolean): AiChange => (ok ? { ok: true, status: status() } : { ok: false, message: STORAGE_FAILED });
  const failure = (status: number, erro: string) => ({ status, body: { erro } });

  return {
    place: 'browser',
    async status() {
      return status();
    },
    async saveKey(value) {
      const problem = apiKeyProblem(value);
      if (problem) return { ok: false, message: problem };
      return changed(write(KEY_ITEM, value.trim()));
    },
    async removeKey() {
      return changed(write(KEY_ITEM, null));
    },
    async setEnabled(on) {
      return changed(write(ENABLED_ITEM, on ? '1' : null));
    },
    async propose(request: IaRequest, library: Library) {
      const apiKey = key();
      // No key or off: nothing leaves the browser.
      if (!apiKey || read(ENABLED_ITEM) !== '1') return failure(409, 'A IA está desligada. Ligue em Configurações, Assistente de IA.');
      const text = typeof request.pedido === 'string' ? request.pedido : '';
      const invalid = requestProblem(text);
      if (invalid) return failure(400, invalid);
      if (busy) return failure(429, 'A IA ainda está pensando no pedido anterior.');
      const wait = BROWSER_INTERVAL_MS - (now() - last);
      if (wait > 0) return failure(429, `Espere ${Math.ceil(wait / 1000)} s para pedir de novo.`);
      if (!library.shows.some((show) => show.episodes.length > 0)) return failure(400, 'A biblioteca não tem programas com episódios.');

      const current = request.atual === undefined ? null : validateProposal(request.atual, library);
      const { system, prompt } = buildProposalPrompt({
        library,
        request: text.trim(),
        current: current?.ok ? current.proposal : null,
        durations: request.duracoes,
      });
      const { headers, body } = anthropicRequest(apiKey, ANTHROPIC_MODEL, { system, prompt, schema: proposalSchema(library) }, { browser: true });
      busy = true;
      last = now();
      try {
        let res: Response;
        try {
          res = await send(ANTHROPIC_URL, { method: 'POST', headers, body, signal: AbortSignal.timeout(options.timeoutMs ?? TIMEOUT_MS) });
        } catch (error) {
          // The error of fetch is left out on purpose: only our own words reach the screen.
          return (error as Error)?.name === 'TimeoutError'
            ? failure(504, 'A IA demorou demais para responder. Tente de novo.')
            : failure(504, 'Não consegui falar com a Anthropic. Confira a internet deste aparelho.');
        }
        if (!res.ok) {
          await res.body?.cancel().catch(() => {});
          const { message, status: code } = anthropicStatusFailure(res.status);
          return failure(code, message);
        }
        const answer = anthropicAnswer(await res.json().catch(() => null));
        if (!('text' in answer)) return failure(answer.status, answer.message);
        const result = parseProposal(answer.text, library);
        if (!result.ok) return failure(422, `A proposta da IA não serve: ${result.error}`);
        return { status: 200, body: { proposta: result.proposal } };
      } finally {
        busy = false;
      }
    },
  };
}
