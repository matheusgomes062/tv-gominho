// The optional AI assistant of `tv-gominho servir` (docs/ferramentas.md#assistente-de-ia) talks to a provider through this
// interface only, so another one (ChatGPT) can be added next to anthropic.ts without touching the server route.

export interface ProposalRequest {
  /** The instructions. */
  system: string;
  /** The library's metadata and the person's request, as data (see prompt.ts). */
  prompt: string;
  /** The JSON schema the answer must follow. */
  schema: Record<string, unknown>;
  signal?: AbortSignal;
}

export interface IaProvider {
  /** "Anthropic". */
  readonly name: string;
  readonly model: string;
  /** The answer as JSON text, following `schema`. Fails with an IaError. */
  propose(request: ProposalRequest): Promise<string>;
}

/**
 * A failure to show to the person as is (pt-BR). Never carries the key, the request or the provider's answer:
 * only what went wrong, from our own list of messages.
 */
export class IaError extends Error {
  constructor(
    message: string,
    /** The HTTP status the server answers the app with. */
    readonly status = 502,
  ) {
    super(message);
    this.name = 'IaError';
  }
}
