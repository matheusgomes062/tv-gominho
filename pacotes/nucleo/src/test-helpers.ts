import type { LibrarySource } from './types';

/** An in-memory library: file path -> contents ('' for videos and images). */
export function memorySource(files: Record<string, string>): LibrarySource {
  return {
    files: Object.keys(files),
    async readText(path) {
      const text = files[path];
      if (text === undefined) throw new Error(`No such file: ${path}`);
      return text;
    },
  };
}
