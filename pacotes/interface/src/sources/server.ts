import type { BrowserLibrary } from './types';

const LIST = '/__biblioteca/lista';

/**
 * The library served over HTTP: by `tv-gominho servir` (PC, Raspberry Pi, other
 * devices on the network) or, in development, by the Vite dev server (see vite.config.ts).
 */
export async function openServerLibrary(): Promise<BrowserLibrary> {
  const response = await fetch(LIST);
  const data = (await response.json()) as { name: string; base: string; files: string[]; error?: string };
  if (!response.ok) throw new Error(data.error ?? 'Biblioteca do servidor indisponível.');

  const url = (path: string) => data.base + path.split('/').map(encodeURIComponent).join('/');
  return {
    name: data.name,
    files: data.files,
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
