// The AI's settings in `tv-gominho servir` (docs/ferramentas.md#assistente-de-ia): the Anthropic key typed in the app and whether
// the AI is on. Anyone may read the state (no key in it); only the browser of this computer may change it, which the
// server knows from the connection's own address, never from a header. The key is kept in the app's data folder
// (ia/chave.ts) and never leaves this process: no answer, log line or error carries it, only its last four characters
// go to this computer's browser.

import type { IncomingMessage, ServerResponse } from 'node:http';
import { apiKeyProblem, keyEnding } from '@tv-gominho/nucleo';
import { insideFolder, type KeyStore } from '../ia/chave';
import type { IaProvider } from '../ia/provider';
import { fail, readBody, sameOrigin } from './edit';
import { sendJson } from './http';

export const IA_STATE_PATH = '/__tv-gominho/ia/estado';
export const IA_KEY_PATH = '/__tv-gominho/ia/chave';
export const IA_SWITCH_PATH = '/__tv-gominho/ia/ligada';

/** A key and some JSON around it. */
export const MAX_KEY_BODY = 2048;
const BODY_TIMEOUT_MS = 10_000;

const NOT_HERE = 'Só o computador que roda o servidor pode mudar a chave e ligar ou desligar a IA. Faça isso no navegador desse computador, em http://localhost.';
const STORE_FAILED = 'Não consegui gravar na pasta de dados do app neste computador.';

/** The connection comes from this computer. Only the socket's address counts: Host, Origin or X-Forwarded-For can say anything. */
export function isLoopback(address: string | undefined): boolean {
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';
}

export type KeySource = 'nenhuma' | 'salva' | 'ambiente';

export interface IaConfigOptions {
  store: KeyStore;
  /** The library being served: the key is never kept inside it. */
  library: string;
  /** ANTHROPIC_API_KEY: wins over a saved key, and the app cannot remove it. */
  envKey?: string;
  /** --ia: on from the start of this run, whatever the app chose. */
  startOn?: boolean;
  model: string;
  /** The provider for a key (Anthropic, or a fake in tests). */
  provider(key: string): IaProvider;
  /** Lines for the terminal: never the key. */
  log(message: string): void;
  /** Called when the AI becomes available (to show the PIN in the terminal). */
  onAvailable?(): void;
  /** For tests: the connection's address. Default: the socket's. */
  remoteAddress?(req: IncomingMessage): string | undefined;
}

export type IaConfig = Awaited<ReturnType<typeof createIaConfig>>;

export async function createIaConfig(options: IaConfigOptions) {
  const { store, envKey } = options;
  const remote = options.remoteAddress ?? ((req: IncomingMessage) => req.socket.remoteAddress);
  // The data folder could be pointed into the library (XDG_CONFIG_HOME, LOCALAPPDATA): then nothing is kept there.
  const storeInLibrary = insideFolder(options.library, store.dir);
  let savedKey = envKey || storeInLibrary ? undefined : await store.readKey();
  let enabled = Boolean(options.startOn) || (await store.readEnabled());
  let cached: { key: string; provider: IaProvider } | undefined;

  const key = () => envKey ?? savedKey;
  const available = () => enabled && key() !== undefined;
  const isLocal = (req: IncomingMessage) => isLoopback(remote(req));

  function state(req: IncomingMessage) {
    const source: KeySource = envKey ? 'ambiente' : savedKey ? 'salva' : 'nenhuma';
    return {
      chave: source,
      // Only this computer's browser sees even the end of the key.
      ...(source === 'salva' && isLocal(req) ? { final: keyEnding(savedKey!) } : {}),
      ligada: enabled,
      disponivel: available(),
      local: isLocal(req),
      modelo: options.model,
    };
  }

  /** The JSON body of a settings change, or null when an answer was already sent. */
  async function readJson(req: IncomingMessage, res: ServerResponse): Promise<Record<string, unknown> | null> {
    let problem: [number, string] = [400, 'O pedido não é JSON válido.'];
    if (!String(req.headers['content-type'] ?? '').startsWith('application/json')) problem = [415, 'Envie como JSON.'];
    else if (Number(req.headers['content-length'] ?? 0) > MAX_KEY_BODY) problem = [413, 'Pedido grande demais.'];
    else {
      req.setTimeout(BODY_TIMEOUT_MS, () => req.destroy());
      const body = await readBody(req, MAX_KEY_BODY);
      if (body === null) problem = [413, 'Pedido grande demais.'];
      else {
        try {
          const value = JSON.parse(body.toString('utf8')) as unknown;
          if (typeof value === 'object' && value !== null) return value as Record<string, unknown>;
        } catch {
          // not JSON
        }
      }
    }
    fail(req, res, ...problem);
    return null;
  }

  async function change(req: IncomingMessage, res: ServerResponse, url: string) {
    if (url === IA_KEY_PATH && req.method === 'PUT') {
      if (envKey) return fail(req, res, 409, 'A chave está definida neste computador na variável ANTHROPIC_API_KEY, que vale no lugar de uma chave salva pelo app.');
      if (storeInLibrary) return fail(req, res, 500, 'A pasta de dados do app fica dentro da biblioteca, e a chave nunca é guardada na biblioteca.');
      const body = await readJson(req, res);
      if (!body) return;
      const given = typeof body.chave === 'string' ? body.chave : '';
      const problem = apiKeyProblem(given);
      if (problem) return fail(req, res, 400, problem);
      try {
        await store.saveKey(given);
      } catch {
        return fail(req, res, 500, STORE_FAILED);
      }
      const wasAvailable = available();
      savedKey = given.trim();
      options.log('IA: chave salva pelo app neste computador.');
      if (!wasAvailable && available()) options.onAvailable?.();
      return sendJson(req, res, state(req));
    }
    if (url === IA_KEY_PATH && req.method === 'DELETE') {
      if (envKey) return fail(req, res, 409, 'A chave está na variável ANTHROPIC_API_KEY deste computador. Para tirá-la, apague a linha do arquivo .env ou a variável do sistema.');
      try {
        await store.removeKey();
      } catch {
        return fail(req, res, 500, STORE_FAILED);
      }
      savedKey = undefined;
      cached = undefined;
      options.log('IA: chave removida deste computador.');
      return sendJson(req, res, state(req));
    }
    if (url === IA_SWITCH_PATH && req.method === 'PUT') {
      const body = await readJson(req, res);
      if (!body) return;
      if (typeof body.ligada !== 'boolean') return fail(req, res, 400, 'Diga se a IA fica ligada (true) ou desligada (false).');
      try {
        await store.saveEnabled(body.ligada);
      } catch {
        return fail(req, res, 500, STORE_FAILED);
      }
      const wasAvailable = available();
      enabled = body.ligada;
      options.log(enabled ? 'IA: ligada pelo app.' : 'IA: desligada pelo app.');
      if (!wasAvailable && available()) options.onAvailable?.();
      return sendJson(req, res, state(req));
    }
    res.statusCode = 405;
    res.end();
  }

  return {
    available,
    isLocal,
    /** The provider with the current key while the AI is on; undefined otherwise. */
    provider(): IaProvider | undefined {
      const current = key();
      if (!enabled || current === undefined) return undefined;
      if (cached?.key !== current) cached = { key: current, provider: options.provider(current) };
      return cached.provider;
    },
    /** Handles the request when it is one of the AI's settings routes; false otherwise. */
    async handle(req: IncomingMessage, res: ServerResponse, url: string): Promise<boolean> {
      if (url === IA_STATE_PATH && (req.method === 'GET' || req.method === 'HEAD')) {
        sendJson(req, res, state(req));
        return true;
      }
      if (url !== IA_KEY_PATH && url !== IA_SWITCH_PATH) return false;
      // The address first: a device on the network is told where to do it, whatever it sent.
      if (!isLocal(req)) fail(req, res, 403, NOT_HERE);
      // CSRF and DNS rebinding: a page elsewhere, even opened on this computer, cannot fake Origin.
      else if (!sameOrigin(req)) fail(req, res, 403, 'Origem não permitida.');
      else await change(req, res, url);
      return true;
    },
  };
}
