import type { BrowserLibrary } from './types';

/** Development only: the library served by the Vite dev server (see vite.config.ts). */
export async function openDevLibrary(): Promise<BrowserLibrary> {
  const response = await fetch('/__biblioteca/lista');
  const data = (await response.json()) as { name: string; base: string; files: string[]; error?: string };
  if (!response.ok) throw new Error(data.error ?? 'Biblioteca de exemplo indisponível.');

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
