import { pairOutcome, writeOutcome, type PairOutcome } from '../pin-model';
import type { BrowserLibrary, ServerAssistant, ServerEditing } from './types';

const LIST = '/__biblioteca/lista';
const CAPABILITIES = '/__tv-gominho/capacidades';
const PAIRING = '/__tv-gominho/pareamento';
const FILES = '/__tv-gominho/arquivos/';
const IA = '/__tv-gominho/ia/proposta';

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
    ...(offered.ia === true ? { assistant: serverAssistant() } : {}),
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
  ia?: unknown;
}

/** What the server offers (--editar, --ia); the dev server and older versions answer something else, or nothing. */
async function capabilities(): Promise<Capabilities> {
  try {
    const response = await fetch(CAPABILITIES);
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

/** The AI assistant, when the server was started with --ia and has a key. */
function serverAssistant(): ServerAssistant {
  return {
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
