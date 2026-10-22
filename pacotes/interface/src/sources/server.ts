import { pairOutcome, writeOutcome } from '../pin-model';
import type { BrowserLibrary, ServerEditing } from './types';

const LIST = '/__biblioteca/lista';
const CAPABILITIES = '/__tv-gominho/capacidades';
const PAIRING = '/__tv-gominho/pareamento';
const FILES = '/__tv-gominho/arquivos/';

/**
 * The library served over HTTP: by `tv-gominho servir` (PC, Raspberry Pi, other
 * devices on the network) or, in development, by the Vite dev server (see vite.config.ts).
 */
export async function openServerLibrary(): Promise<BrowserLibrary> {
  const [response, editing] = await Promise.all([fetch(LIST), serverEditing()]);
  const data = (await response.json()) as { name: string; base: string; files: string[]; error?: string };
  if (!response.ok) throw new Error(data.error ?? 'Biblioteca do servidor indisponível.');

  const url = (path: string) => data.base + path.split('/').map(encodeURIComponent).join('/');
  return {
    name: data.name,
    files: data.files,
    ...(editing ? { editing } : {}),
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

/** Saving through the server, when it was started with --editar (the dev server and older versions answer something else). */
async function serverEditing(): Promise<ServerEditing | undefined> {
  try {
    const response = await fetch(CAPABILITIES);
    if (!response.ok || !(response.headers.get('content-type') ?? '').includes('json')) return undefined;
    if ((await response.json() as { editar?: unknown }).editar !== true) return undefined;
  } catch {
    return undefined;
  }
  return {
    async pair(pin) {
      try {
        const response = await fetch(PAIRING, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pin }) });
        return pairOutcome(response.status);
      } catch {
        return 'failed';
      }
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
