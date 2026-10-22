// A minimal client for TypeSafe's System One API (the Jev model): one POST with
// `fetch`, no SDK, so the tool stays a single small file. Docs: https://docs.typesafe.ai/api
// Answers are cached on disk by request, so re-running a command (first with
// --simular, then for real) asks Jev only once.

import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { CliError } from '../errors';

export const JEV_URL = 'https://api.typesafe.ai/v1/systemone';
export const JEV_MODEL = 'jev-latest';
const TIMEOUT_MS = 60_000;
const RETRIES = 2;

export type Criteria = string | null | Record<string, unknown> | unknown[];

export type Question =
  | { type: 'choice'; instructions: Criteria; criteria: Record<string, Criteria> }
  | { type: 'noul'; instructions: Criteria }
  | { type: 'score'; instructions: Criteria; criteria: Criteria[] };

export interface ChoiceAnswer {
  type: 'choice';
  choice: string;
  confidence: number;
  probabilities: Record<string, number>;
}
export interface NoulAnswer {
  type: 'noul';
  noul: number;
}
export type Answer = ChoiceAnswer | NoulAnswer | { type: 'score'; score: number; confidence: number; probabilities: Record<string, number> };

export interface JevRequest {
  state: unknown;
  questions: Record<string, Question>;
}

export interface JevResponse {
  answers: Record<string, Answer>;
  usage?: { input_tokens: number; output_tokens: number };
}

export interface JevClient {
  ask(request: JevRequest): Promise<JevResponse>;
  /** Input tokens of the requests actually sent (cached answers cost nothing). */
  readonly tokens: number;
  readonly requests: number;
  /** Writes the cache to disk. */
  save(): Promise<void>;
}

export interface JevOptions {
  apiKey: string;
  /** JSON file for cached answers; none = no cache. */
  cacheFile?: string;
  signal?: AbortSignal;
  /** For tests. */
  fetch?: typeof fetch;
}

export async function createJevClient(options: JevOptions): Promise<JevClient> {
  const send = options.fetch ?? fetch;
  let cache: Record<string, JevResponse> = {};
  if (options.cacheFile) {
    cache = await readFile(options.cacheFile, 'utf8').then((text) => JSON.parse(text) as Record<string, JevResponse>, () => ({}));
  }
  let tokens = 0;
  let requests = 0;

  async function post(body: string): Promise<JevResponse> {
    for (let attempt = 0; ; attempt++) {
      const signals = [AbortSignal.timeout(TIMEOUT_MS), ...(options.signal ? [options.signal] : [])];
      let res: Response;
      try {
        res = await send(JEV_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${options.apiKey}` },
          body,
          signal: AbortSignal.any(signals),
        });
      } catch (error) {
        if (options.signal?.aborted) throw error;
        if (attempt < RETRIES) continue;
        throw new CliError(`Não consegui falar com o Jev (${(error as Error).message}). Confira a internet e tente de novo.`);
      }
      if (res.ok) return (await res.json()) as JevResponse;
      // Busy or failing server: try again a little later.
      if ((res.status === 429 || res.status >= 500) && attempt < RETRIES) {
        await new Promise((resolve) => setTimeout(resolve, 1000 * 2 ** attempt));
        continue;
      }
      if (res.status === 401 || res.status === 403) throw new CliError('O Jev recusou a chave em TYPESAFE_API_KEY. Confira a chave no arquivo .env.');
      throw new CliError(`O Jev respondeu com erro ${res.status}: ${(await res.text()).slice(0, 300)}`);
    }
  }

  return {
    async ask(request) {
      const body = JSON.stringify({ model: JEV_MODEL, ...request });
      const key = createHash('sha256').update(body).digest('hex');
      const cached = cache[key];
      if (cached) return cached;
      const response = await post(body);
      requests++;
      tokens += response.usage?.input_tokens ?? 0;
      cache[key] = { answers: response.answers };
      return response;
    },
    get tokens() {
      return tokens;
    },
    get requests() {
      return requests;
    },
    async save() {
      if (!options.cacheFile) return;
      await mkdir(path.dirname(options.cacheFile), { recursive: true });
      await writeFile(options.cacheFile, JSON.stringify(cache));
    },
  };
}

/** The key from TYPESAFE_API_KEY, or an error that says how to set it up. */
export function jevApiKey(env: NodeJS.ProcessEnv = process.env): string {
  const key = env.TYPESAFE_API_KEY?.trim();
  if (!key) {
    throw new CliError(
      'Este comando usa o Jev (TypeSafe) e precisa de uma chave. Crie uma em https://typesafe.ai, ' +
        'coloque TYPESAFE_API_KEY=<chave> num arquivo .env e rode com "npm run cli -- ..." ' +
        '(ou defina a variável de ambiente TYPESAFE_API_KEY).',
    );
  }
  return key;
}

export const isChoice = (answer: Answer | undefined): answer is ChoiceAnswer => answer?.type === 'choice';
export const isNoul = (answer: Answer | undefined): answer is NoulAnswer => answer?.type === 'noul';
