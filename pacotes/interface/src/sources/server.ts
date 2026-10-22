import { aiStatusFromServer } from '../ai-settings-model';
import { pairOutcome, writeOutcome, type PairOutcome } from '../pin-model';
import { browserAi } from './ai-browser';
import type { AiBackend, AiChange, BrowserLibrary, ServerEditing } from './types';

const LIST = '/__biblioteca/lista';
const CAPABILITIES = '/__tv-gominho/capacidades';
const PAIRING = '/__tv-gominho/pareamento';
const FILES = '/__tv-gominho/arquivos/';
const IA = '/__tv-gominho/ia/proposta';
const IA_STATE = '/__tv-gominho/ia/estado';
const IA_KEY = '/__tv-gominho/ia/chave';
const IA_SWITCH = '/__tv-gominho/ia/ligada';

/**
 * The library served over HTTP: by `tv-gominho servir` (PC, Raspberry Pi, other
 * devices on the network) or, in development, by the Vite dev server (see vite.config.ts).
 */
export async function openServerLibrary(): Promise<BrowserLibrary> {
  const [response, offered] = await Promise.all([fetch(LIST), capabilities()]);
  const data = (await response.json()) as { name: string; base: string; files: string[]; error?: string };
  if (!response.ok) throw new Error(data.error ?? 'Biblioteca do servidor indisponível.');

  const url = (path: string) => data.base + path.split('/').map(encodeURIComponent).join('/');
  return {
    name: data.name,
    files: data.files,
    ...(offered.editar === true ? { editing: serverEditing() } : {}),
    // A server that keeps the AI's settings; anything else (the dev server) gets the browser's own.
    ai: offered.configIa === true ? serverAi() : browserAi(),
    async readText(path) {
      return (await fetch(url(path))).text();
    },
    async url(path) {
      return url(path);
    },
    async fingerprint() {
      return undefined;
    },
    dispose() {},
  };
}

interface Capabilities {
  editar?: unknown;
  /** This device already paired with the PIN. */
  pareado?: unknown;
  ia?: unknown;
  configIa?: unknown;
}

/** What the server offers (--editar, the AI); the dev server and older versions answer something else, or nothing. */
async function capabilities(): Promise<Capabilities> {
  try {
    const response = await fetch(CAPABILITIES, { cache: 'no-store' });
    if (!response.ok || !(response.headers.get('content-type') ?? '').includes('json')) return {};
    return ((await response.json()) as Capabilities | null) ?? {};
  } catch {
    return {};
  }
}

async function pair(pin: string): Promise<PairOutcome> {
  try {
    const response = await fetch(PAIRING, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pin }) });
    return pairOutcome(response.status);
  } catch {
    return 'failed';
  }
}

/** Saving through the server, when it was started with --editar. */
function serverEditing(): ServerEditing {
  return {
    pair,
    async isPaired() {
      return (await capabilities()).pareado === true;
    },
    async write(path, text, overwrite = false) {
      try {
        const target = FILES + path.split('/').map(encodeURIComponent).join('/') + (overwrite ? '?substituir=1' : '');
        const response = await fetch(target, { method: 'PUT', headers: { 'Content-Type': 'text/yaml; charset=utf-8' }, body: text });
        return writeOutcome(response.status);
      } catch {
        return 'failed';
      }
    },
    async replaceWithBackup(path, text) {
      try {
        const target = FILES + path.split('/').map(encodeURIComponent).join('/') + '?substituir=1&copia=1';
        const response = await fetch(target, { method: 'PUT', headers: { 'Content-Type': 'text/yaml; charset=utf-8' }, body: text });
        const status = writeOutcome(response.status);
        if (status !== 'written') return { status };
        const body = (await response.json().catch(() => ({}))) as { copia?: unknown };
        return typeof body.copia === 'string' ? { status, backup: body.copia } : { status };
      } catch {
        return { status: 'failed' };
      }
    },
  };
}

/** The AI through `tv-gominho servir`: the key stays on that computer; only its browser may change it. */
function serverAi(): AiBackend {
  async function status() {
    try {
      const response = await fetch(IA_STATE);
      return response.ok ? aiStatusFromServer(await response.json()) : null;
    } catch {
      return null;
    }
  }
  async function change(method: string, path: string, body?: unknown): Promise<AiChange> {
    try {
      const response = await fetch(path, {
        method,
        ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
      });
      const answer = (await response.json().catch(() => null)) as { erro?: unknown } | null;
      const parsed = response.ok ? aiStatusFromServer(answer) : null;
      if (parsed) return { ok: true, status: parsed };
      return { ok: false, message: typeof answer?.erro === 'string' && answer.erro ? answer.erro : 'Não deu para falar com o computador. Ele ainda está ligado?' };
    } catch {
      return { ok: false, message: 'Não deu para falar com o computador. Ele ainda está ligado?' };
    }
  }
  return {
    place: 'server',
    status,
    saveKey: (key) => change('PUT', IA_KEY, { chave: key }),
    removeKey: () => change('DELETE', IA_KEY),
    setEnabled: (on) => change('PUT', IA_SWITCH, { ligada: on }),
    pair,
    async propose(request) {
      try {
        const response = await fetch(IA, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request) });
        return { status: response.status, body: await response.json().catch(() => null) };
      } catch {
        return { status: 0, body: null };
      }
    },
  };
}

/** Whether the page came from a server with a library (false when opened from a file or a static host). */
export async function hasServerLibrary(): Promise<boolean> {
  if (location.protocol !== 'http:' && location.protocol !== 'https:') return false;
  try {
    const response = await fetch(LIST, { method: 'HEAD' });
    return response.ok && (response.headers.get('content-type') ?? '').includes('json');
  } catch {
    return false;
  }
}
