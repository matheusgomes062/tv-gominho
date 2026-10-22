// Claude through the Anthropic Messages API: one POST with `fetch`, no SDK, like the Jev client (jev/client.ts), so
// the tool stays a single small file with no dependencies. Docs: https://platform.claude.com/docs/en/api/messages
// The answer is a structured output (output_config.format, a JSON schema), so the model returns the wizard's choices
// as JSON and never a grade file.

import { IaError, type IaProvider, type ProposalRequest } from './provider';

export const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
/** The latest, most capable Claude model; `--ia-modelo` picks another. */
export const ANTHROPIC_MODEL = 'claude-opus-5-5';
export const ANTHROPIC_VERSION = '2026-10-21';
/** Models that take the server-side refusal fallback (`fallbacks: "default"`). */
const FALLBACK_MODELS = new Set(['claude-opus-5-5', 'claude-opus-5', 'claude-fable-5-1', 'claude-sonnet-5-5']);
const FALLBACK_BETA = 'server-side-fallback-2026-07-01';
/** Thinking counts against this too; a proposal itself is a few hundred tokens. */
export const MAX_TOKENS = 8000;
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

interface MessagesResponse {
  stop_reason?: string | null;
  content?: Array<{ type: string; text?: string }>;
}

export function createAnthropicProvider(options: AnthropicOptions): IaProvider {
  const send = options.fetch ?? fetch;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const model = options.model ?? ANTHROPIC_MODEL;
  const url = options.url ?? ANTHROPIC_URL;
  const timeout = options.timeoutMs ?? TIMEOUT_MS;
  const fallback = FALLBACK_MODELS.has(model);

  return {
    name: 'Anthropic',
    model,
    async propose(request: ProposalRequest): Promise<string> {
      const body = JSON.stringify({
        model,
        max_tokens: MAX_TOKENS,
        system: request.system,
        messages: [{ role: 'user', content: request.prompt }],
        output_config: { effort: 'medium', format: { type: 'json_schema', schema: request.schema } },
        // On a safety refusal the API retries on a model that can answer, inside the same call.
        ...(fallback ? { fallbacks: 'default' } : {}),
      });
      const headers: Record<string, string> = {
        'content-type': 'application/json',
        'x-api-key': options.apiKey,
        'anthropic-version': ANTHROPIC_VERSION,
        ...(fallback ? { 'anthropic-beta': FALLBACK_BETA } : {}),
      };

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
        if (res.ok) return answerText((await res.json().catch(() => null)) as MessagesResponse | null);
        // Busy, overloaded or failing: try again a little later. The body is not read: nothing from it reaches the app.
        if ((res.status === 429 || res.status >= 500) && attempt < RETRIES) {
          await res.body?.cancel().catch(() => {});
          const after = Number(res.headers.get('retry-after'));
          await sleep(Math.min(MAX_RETRY_WAIT_MS, after > 0 ? after * 1000 : 1000 * 2 ** attempt));
          continue;
        }
        await res.body?.cancel().catch(() => {});
        throw statusError(res.status);
      }
    },
  };
}

function statusError(status: number): IaError {
  if (status === 401 || status === 403) return new IaError('A Anthropic recusou a chave em ANTHROPIC_API_KEY. Confira a chave no computador.');
  if (status === 429) return new IaError('A Anthropic está recebendo pedidos demais desta chave. Espere um pouco e tente de novo.', 429);
  if (status === 402) return new IaError('A conta da Anthropic está sem crédito.');
  if (status >= 500) return new IaError('A Anthropic está com problemas agora. Tente de novo mais tarde.');
  return new IaError(`A Anthropic recusou o pedido (erro ${status}).`);
}

function answerText(response: MessagesResponse | null): string {
  if (!response) throw new IaError('A Anthropic respondeu num formato que o app não entende.');
  if (response.stop_reason === 'refusal') throw new IaError('A IA não quis responder a esse pedido. Tente com outras palavras.', 422);
  if (response.stop_reason === 'max_tokens') throw new IaError('A resposta da IA ficou incompleta. Tente um pedido mais simples.');
  const text = (response.content ?? [])
    .filter((block) => block.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join('');
  if (!text) throw new IaError('A IA respondeu sem uma proposta.');
  return text;
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
