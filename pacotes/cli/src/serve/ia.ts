// The optional AI assistant of `tv-gominho servir --ia` (docs/ferramentas.md#ia): the app sends a request in
// Portuguese, this server asks the provider for a proposal with the library's metadata, checks it and answers with
// the wizard's choices. The key stays in this process; the app only ever sees proposals and our own messages.

import type { IncomingMessage, ServerResponse } from 'node:http';
import { MAX_REQUEST_LENGTH, parseProposal, proposalSchema, scanLibrary, validateProposal, type Library, type Proposal } from '@tv-gominho/nucleo';
import { buildProposalPrompt } from '../ia/prompt';
import { IaError, type IaProvider } from '../ia/provider';
import { openNodeLibrary } from '../node-source';
import { fail, readBody } from './edit';
import { sendJson } from './http';

/** Largest request body: the text, the wizard as it is and a few durations. */
export const MAX_IA_BODY = 16 * 1024;
/** At least this long between two requests. */
export const IA_INTERVAL_MS = 5_000;
/** At most this many requests per hour: each one costs money. */
export const IA_PER_HOUR = 30;
const BODY_TIMEOUT_MS = 10_000;
const MAX_DURATION_MIN = 300;

export interface AssistantOptions {
  provider: IaProvider;
  /** Lines for the terminal: never the request or the answer. */
  log(message: string): void;
  now?(): number;
  /** For tests: the library as the server sees it. */
  loadLibrary?(): Promise<Library>;
}

export type Assistant = ReturnType<typeof createAssistant>;

export function createAssistant(libraryDir: string, options: AssistantOptions) {
  const now = options.now ?? Date.now;
  const load = options.loadLibrary ?? (async () => scanLibrary(await openNodeLibrary(libraryDir)));
  let busy = false;
  let last = -Infinity;
  const recent: number[] = [];

  /** Answers 429 when a request is running, came too soon or the hour's budget is spent. */
  function refuseIfLimited(res: ServerResponse, req: IncomingMessage): boolean {
    const time = now();
    while (recent.length > 0 && recent[0]! <= time - 3600_000) recent.shift();
    let wait = 0;
    if (busy) wait = 1;
    else if (time - last < IA_INTERVAL_MS) wait = IA_INTERVAL_MS - (time - last);
    else if (recent.length >= IA_PER_HOUR) wait = recent[0]! + 3600_000 - time;
    if (wait <= 0) return false;
    const seconds = Math.max(1, Math.ceil(wait / 1000));
    res.setHeader('Retry-After', seconds);
    sendJson(req, res, { erro: busy ? 'A IA ainda está pensando no pedido anterior.' : `Espere ${seconds} s para pedir de novo.` }, 429);
    return true;
  }

  return {
    /** POST IA_PATH, after the caller checked the origin and the session. */
    async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
      if (!String(req.headers['content-type'] ?? '').startsWith('application/json')) return fail(req, res, 415, 'Envie o pedido como JSON.');
      if (Number(req.headers['content-length'] ?? 0) > MAX_IA_BODY) return fail(req, res, 413, 'Pedido grande demais.');
      if (refuseIfLimited(res, req)) return;
      busy = true;
      try {
        req.setTimeout(BODY_TIMEOUT_MS, () => req.destroy());
        const body = await readBody(req, MAX_IA_BODY);
        if (body === null) return fail(req, res, 413, 'Pedido grande demais.');
        let input: { pedido?: unknown; atual?: unknown; duracoes?: unknown };
        try {
          input = JSON.parse(body.toString('utf8')) as typeof input;
        } catch {
          return fail(req, res, 400, 'O pedido não é JSON válido.');
        }
        const request = typeof input?.pedido === 'string' ? input.pedido.trim() : '';
        if (request === '') return fail(req, res, 400, 'Escreva o que você quer no canal.');
        if (request.length > MAX_REQUEST_LENGTH) return fail(req, res, 400, `Use no máximo ${MAX_REQUEST_LENGTH} letras no pedido.`);

        const library = await load();
        if (!library.shows.some((show) => show.episodes.length > 0)) return fail(req, res, 400, 'A biblioteca não tem programas com episódios.');
        const current = input.atual === undefined ? null : validateProposal(input.atual, library);
        const durations = cleanDurations(input.duracoes, library);

        // Counted before the call: a request that fails at the provider may still cost money.
        last = now();
        recent.push(last);
        options.log('IA: proposta pedida.');
        const { system, prompt } = buildProposalPrompt({ library, request, current: current?.ok ? current.proposal : null, durations });
        let proposal: Proposal;
        try {
          const text = await options.provider.propose({ system, prompt, schema: proposalSchema(library) });
          const result = parseProposal(text, library);
          if (!result.ok) throw new IaError(`A proposta da IA não serve: ${result.error}`, 422);
          proposal = result.proposal;
        } catch (error) {
          options.log('IA: proposta com erro.');
          const known = error instanceof IaError ? error : new IaError('A IA não conseguiu montar uma proposta. Tente de novo.');
          return fail(req, res, known.status, known.message);
        }
        options.log('IA: proposta ok.');
        sendJson(req, res, { proposta: proposal });
      } finally {
        busy = false;
      }
    },
  };
}

/** Durations the app measured, in minutes: only for shows of the library, as whole numbers in a sane range. */
function cleanDurations(value: unknown, library: Library): Record<string, number> {
  const result: Record<string, number> = {};
  if (typeof value !== 'object' || value === null) return result;
  for (const show of library.shows) {
    const minutes = (value as Record<string, unknown>)[show.id];
    if (typeof minutes === 'number' && Number.isFinite(minutes) && minutes > 0) result[show.id] = Math.min(MAX_DURATION_MIN, Math.max(1, Math.round(minutes)));
  }
  return result;
}
