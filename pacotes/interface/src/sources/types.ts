import type { LibrarySource } from '@tv-gominho/nucleo';
import type { PairOutcome, WriteOutcome } from '../pin-model';

/** Saving through `tv-gominho servir --editar`: pair once with the PIN, then write channel files. */
export interface ServerEditing {
  pair(pin: string): Promise<PairOutcome>;
  /** Writes a new file (never over an existing one) at a library path such as "grades/manha.yaml". */
  write(path: string, text: string): Promise<WriteOutcome>;
}

/** A library folder opened in the browser. */
export interface BrowserLibrary extends LibrarySource {
  /** Folder name, shown to the user. */
  name: string;
  /** The picked folder, when it came from showDirectoryPicker (Chrome/Edge): the way back to write a channel into it. */
  handle?: FileSystemDirectoryHandle;
  /** Present when the library is served by `tv-gominho servir --editar`: the way to write a channel through it. */
  editing?: ServerEditing;
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
