import type { LibrarySource } from '@tv-gominho/nucleo';

/** A library folder opened in the browser. */
export interface BrowserLibrary extends LibrarySource {
  /** Folder name, shown to the user. */
  name: string;
  /** The picked folder, when it came from showDirectoryPicker (Chrome/Edge): the way back to write a channel into it. */
  handle?: FileSystemDirectoryHandle;
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
