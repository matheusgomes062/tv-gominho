// Claude through the Anthropic Messages API: one POST with `fetch`, no SDK, like the Jev client (jev/client.ts), so
// the tool stays a single small file with no dependencies. The request and what its answer means are shared with the
// app on its own in the browser (nucleo/src/anthropic.ts); the retries, timeouts and the key's source live here.

import { ANTHROPIC_MODEL, ANTHROPIC_URL, anthropicAnswer, anthropicRequest, anthropicStatusFailure } from '@tv-gominho/nucleo';
import { IaError, type IaProvider, type ProposalRequest } from './provider';

export { ANTHROPIC_MODEL, ANTHROPIC_URL, ANTHROPIC_VERSION, MAX_TOKENS } from '@tv-gominho/nucleo';
export const TIMEOUT_MS = 90_000;
export const RETRIES = 2;
const MAX_RETRY_WAIT_MS = 10_000;

export interface AnthropicOptions {
  apiKey: string;
  model?: string;
  /** For development and tests only (TV_GOMINHO_IA_URL): a local stand-in for the API. */
  url?: string;
  timeoutMs?: number;
  /** For tests. */
  fetch?: typeof fetch;
  sleep?(ms: number): Promise<void>;
}

export function createAnthropicProvider(options: AnthropicOptions): IaProvider {
  const send = options.fetch ?? fetch;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const model = options.model ?? ANTHROPIC_MODEL;
  const url = options.url ?? ANTHROPIC_URL;
  const timeout = options.timeoutMs ?? TIMEOUT_MS;

  return {
    name: 'Anthropic',
    model,
    async propose(request: ProposalRequest): Promise<string> {
      const { headers, body } = anthropicRequest(options.apiKey, model, request);

      for (let attempt = 0; ; attempt++) {
        let res: Response;
        try {
          const signals = [AbortSignal.timeout(timeout), ...(request.signal ? [request.signal] : [])];
          res = await send(url, { method: 'POST', headers, body, signal: AbortSignal.any(signals) });
        } catch (error) {
          if (request.signal?.aborted) throw new IaError('O pedido foi cancelado.', 499);
          if (attempt < RETRIES) continue;
          // The error of fetch says nothing about the key; its text is still left out on purpose.
          const timedOut = (error as Error).name === 'TimeoutError';
          throw new IaError(
            timedOut ? 'A IA demorou demais para responder. Tente de novo.' : 'Não consegui falar com a Anthropic. Confira a internet do computador.',
            504,
          );
        }
        if (res.ok) {
          const answer = anthropicAnswer(await res.json().catch(() => null));
          if ('text' in answer) return answer.text;
          throw new IaError(answer.message, answer.status);
        }
        // Busy, overloaded or failing: try again a little later. The body is not read: nothing from it reaches the app.
        if ((res.status === 429 || res.status >= 500) && attempt < RETRIES) {
          await res.body?.cancel().catch(() => {});
          const after = Number(res.headers.get('retry-after'));
          await sleep(Math.min(MAX_RETRY_WAIT_MS, after > 0 ? after * 1000 : 1000 * 2 ** attempt));
          continue;
        }
        await res.body?.cancel().catch(() => {});
        const failure = anthropicStatusFailure(res.status);
        throw new IaError(failure.message, failure.status);
      }
    },
  };
}

/** The key from ANTHROPIC_API_KEY, or undefined. */
export function anthropicApiKey(env: NodeJS.ProcessEnv = process.env): string | undefined {
  return env.ANTHROPIC_API_KEY?.trim() || undefined;
}

/**
 * TV_GOMINHO_IA_URL, for development only: where to send the requests instead of the Anthropic API (a local fake
 * server). Only https or this computer, so a typo cannot send the key over the network in the clear.
 */
export function anthropicUrl(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const value = env.TV_GOMINHO_IA_URL?.trim();
  if (!value) return undefined;
  try {
    const url = new URL(value);
    if (url.protocol === 'https:' || (url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) return url.href;
  } catch {
    // not a URL
  }
  throw new IaError('TV_GOMINHO_IA_URL precisa ser um endereço https ou deste computador (http://localhost).');
}
