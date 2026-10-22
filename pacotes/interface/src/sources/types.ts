import type { Library, LibrarySource } from '@tv-gominho/nucleo';
import { browserAi } from './ai-browser';
import type { PairOutcome, WriteOutcome } from '../pin-model';

/** Saving through `tv-gominho servir --editar`: pair once with the PIN, then write channel files. */
export interface ServerEditing {
  pair(pin: string): Promise<PairOutcome>;
  /** Writes a file at a library path such as "grades/manha.yaml": a new one, or over an existing one when `overwrite` is set. */
  write(path: string, text: string, overwrite?: boolean): Promise<WriteOutcome>;
  /**
   * Overwrites the grade at `path`; the server first copies the old file to `<name>.AAAA-MM-DD.yaml.bak` next to it
   * and says where (`backup`, a library path). The client never writes a backup path itself.
   */
  replaceWithBackup(path: string, text: string): Promise<{ status: WriteOutcome; backup?: string }>;
}

/** What the app asks the AI for: the same body the server of `tv-gominho servir` takes (serve/ia.ts in the CLI). */
export interface IaRequest {
  pedido: string;
  /** The wizard's answers so far, in the shape of the proposal schema. */
  atual?: unknown;
  /** Typical minutes per show id. */
  duracoes?: Record<string, number>;
}

/** Where the key lives: on the computer that runs `tv-gominho servir`, or in this browser (app opened on a folder). */
export type AiPlace = 'server' | 'browser';

export interface AiStatus {
  place: AiPlace;
  /** 'env': ANTHROPIC_API_KEY on the server's computer, which the app can neither see nor remove. */
  key: 'none' | 'saved' | 'env';
  /** "…a1B2": all the app ever shows of a saved key, and only where it may be changed. */
  ending?: string;
  /** The person turned the AI on. */
  enabled: boolean;
  /** There is a key and the AI is on: "Pedir para a IA" shows in the wizard. */
  available: boolean;
  /** This screen may change the key: the server's own computer, or this browser for its own key. */
  canManage: boolean;
  model: string;
  /** The app was opened from a file (file://): every page opened from the disk shares this browser's storage. */
  fileOrigin?: boolean;
}

export type AiChange = { ok: true; status: AiStatus } | { ok: false; message: string };

/**
 * The optional AI assistant ("Pedir para a IA"): its settings and the requests. Through the server, the key never
 * reaches the app; in the browser, the app calls the Anthropic API itself with the key kept in this browser.
 */
export interface AiBackend {
  readonly place: AiPlace;
  /** Null when the server did not answer. */
  status(): Promise<AiStatus | null>;
  saveKey(key: string): Promise<AiChange>;
  removeKey(): Promise<AiChange>;
  setEnabled(on: boolean): Promise<AiChange>;
  /** Pairing with the server's PIN; absent in the browser. */
  pair?(pin: string): Promise<PairOutcome>;
  /** The HTTP status and the JSON answer ({ proposta } or { erro }); status 0 when nothing answered. */
  propose(request: IaRequest, library: Library): Promise<{ status: number; body: unknown }>;
}

/** A library folder opened in the browser. */
export interface BrowserLibrary extends LibrarySource {
  /** Folder name, shown to the user. */
  name: string;
  /** The picked folder, when it came from showDirectoryPicker (Chrome/Edge): the way back to write a channel into it. */
  handle?: FileSystemDirectoryHandle;
  /** Present when the library is served by `tv-gominho servir --editar`: the way to write a channel through it. */
  editing?: ServerEditing;
  /** The AI assistant's settings and requests (sources/server.ts or sources/ai-browser.ts). */
  ai?: AiBackend;
  /** A URL the <video>/<img> elements can load. */
  url(path: string): Promise<string>;
  /** Changes when the file changes; used to cache video durations. */
  fingerprint(path: string): Promise<string | undefined>;
  dispose(): void;
}

/** Builds a BrowserLibrary from local File objects (folder picker or <input>). */
export function fileBackedLibrary(
  name: string,
  paths: string[],
  getFile: (path: string) => Promise<File>,
): BrowserLibrary {
  const urls = new Map<string, string>();
  return {
    name,
    files: paths,
    ai: browserAi(),
    async readText(path) {
      return (await getFile(path)).text();
    },
    async url(path) {
      let url = urls.get(path);
      if (!url) {
        url = URL.createObjectURL(await getFile(path));
        urls.set(path, url);
      }
      return url;
    },
    async fingerprint(path) {
      const file = await getFile(path);
      return `${file.size}-${file.lastModified}`;
    },
    dispose() {
      for (const url of urls.values()) URL.revokeObjectURL(url);
      urls.clear();
    },
  };
}
