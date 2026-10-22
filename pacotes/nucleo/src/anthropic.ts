// The parts of a Claude request that do not depend on where it is sent from: the Messages request (headers and
// body), what the answer means and the key's shape. The server of `tv-gominho servir` (cli/src/ia/anthropic.ts) and
// the app on its own in the browser (interface/src/sources/ai-browser.ts) both send it with their own `fetch`.
// Docs: https://platform.claude.com/docs/en/api/messages. The answer is a structured output (output_config.format,
// a JSON schema), so the model returns the wizard's choices as JSON and never a grade file.

export const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
/** The latest, most capable Claude model; `--ia-modelo` picks another. */
export const ANTHROPIC_MODEL = 'claude-opus-5-5';
export const ANTHROPIC_VERSION = '2026-10-21';
/** Thinking counts against this too; a proposal itself is a few hundred tokens. */
export const MAX_TOKENS = 8000;
/** Models that take the server-side refusal fallback (`fallbacks: "default"`). */
const FALLBACK_MODELS = new Set(['claude-opus-5-5', 'claude-opus-5', 'claude-fable-5-1', 'claude-sonnet-5-5']);
const FALLBACK_BETA = 'server-side-fallback-2026-07-01';
/**
 * Lets a web page call the API straight from the browser (CORS). Only for the app opened from a folder, with the
 * person's own key kept in that browser; the server never sends it.
 */
export const BROWSER_ACCESS_HEADER = 'anthropic-dangerous-direct-browser-access';

/** Shortest and longest key taken: Anthropic keys ("sk-ant-...") are around a hundred characters. */
const MIN_KEY = 20;
const MAX_KEY = 400;

export interface AnthropicCall {
  /** The instructions. */
  system: string;
  /** The library's metadata and the person's request, as data (see proposal-prompt.ts). */
  prompt: string;
  /** The JSON schema the answer must follow. */
  schema: Record<string, unknown>;
}

/** A failure to show to the person as is (pt-BR), with the HTTP status the server answers the app with. */
export interface AnthropicFailure {
  message: string;
  status: number;
}

/** The headers and body of one Messages request. The key goes only in the x-api-key header. */
export function anthropicRequest(apiKey: string, model: string, call: AnthropicCall, options: { browser?: boolean } = {}) {
  const fallback = FALLBACK_MODELS.has(model);
  const body = JSON.stringify({
    model,
    max_tokens: MAX_TOKENS,
    system: call.system,
    messages: [{ role: 'user', content: call.prompt }],
    output_config: { effort: 'medium', format: { type: 'json_schema', schema: call.schema } },
    // On a safety refusal the API retries on a model that can answer, inside the same call.
    ...(fallback ? { fallbacks: 'default' } : {}),
  });
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'x-api-key': apiKey,
    'anthropic-version': ANTHROPIC_VERSION,
    ...(fallback ? { 'anthropic-beta': FALLBACK_BETA } : {}),
    ...(options.browser ? { [BROWSER_ACCESS_HEADER]: 'true' } : {}),
  };
  return { headers, body };
}

/** What an HTTP error of the API means. Never anything from the API's own answer. */
export function anthropicStatusFailure(status: number): AnthropicFailure {
  if (status === 401 || status === 403) return { message: 'A Anthropic recusou a chave. Confira a chave em Configurações, Assistente de IA.', status: 502 };
  if (status === 429) return { message: 'A Anthropic está recebendo pedidos demais desta chave. Espere um pouco e tente de novo.', status: 429 };
  if (status === 402) return { message: 'A conta da Anthropic está sem crédito.', status: 502 };
  if (status >= 500) return { message: 'A Anthropic está com problemas agora. Tente de novo mais tarde.', status: 502 };
  return { message: `A Anthropic recusou o pedido (erro ${status}).`, status: 502 };
}

/** The proposal's JSON text in a successful answer, or what went wrong. */
export function anthropicAnswer(response: unknown): { text: string } | AnthropicFailure {
  if (typeof response !== 'object' || response === null) return { message: 'A Anthropic respondeu num formato que o app não entende.', status: 502 };
  const { stop_reason, content } = response as { stop_reason?: unknown; content?: unknown };
  if (stop_reason === 'refusal') return { message: 'A IA não quis responder a esse pedido. Tente com outras palavras.', status: 422 };
  if (stop_reason === 'max_tokens') return { message: 'A resposta da IA ficou incompleta. Tente um pedido mais simples.', status: 502 };
  const text = (Array.isArray(content) ? content : [])
    .filter((block): block is { type: 'text'; text: string } => block?.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join('');
  if (!text) return { message: 'A IA respondeu sem uma proposta.', status: 502 };
  return { text };
}

/** Why a pasted text cannot be a key, or null. Says nothing about the text itself. */
export function apiKeyProblem(key: string): string | null {
  const value = key.trim();
  if (value === '') return 'Cole a chave da Anthropic.';
  // Printable ASCII without spaces: anything else cannot go in a header, and is not a key.
  if (!/^[\x21-\x7e]+$/.test(value) || value.length < MIN_KEY || value.length > MAX_KEY) {
    return 'Isso não parece uma chave da Anthropic. Ela começa com "sk-ant-" e fica em console.anthropic.com, em API Keys.';
  }
  return null;
}

/** All a screen ever shows of a key: its last four characters. */
export function keyEnding(key: string): string {
  return `…${key.trim().slice(-4)}`;
}
