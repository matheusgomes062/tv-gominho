import { downloadText, type DownloadReason, type WriteAccess } from './save';
import type { BrowserLibrary, ServerEditing } from './types';

// Writing several existing files of the library in a row (the "Não passar" list and the grades whose
// positions moved with it). Always over what is there: these files are the app's to update.

export interface SaveFile {
  /** Path in the picked folder, such as "biblioteca/grades/manha.yaml". */
  path: string;
  text: string;
}

export interface SaveFilesResult {
  /** Paths written, in order. */
  written: string[];
  /** Paths that were not written: the one that failed and what came after it (all of them when nothing could be written). */
  pending: string[];
  /** Why `pending` is not empty. */
  reason?: DownloadReason;
}

/** Writes `path` in the folder, replacing the file or creating it (and the folders above it). */
async function overwriteInFolder(handle: FileSystemDirectoryHandle, path: string, text: string): Promise<void> {
  const parts = path.split('/').filter(Boolean);
  const name = parts.pop();
  if (!name) throw new Error('empty path');
  let dir = handle;
  for (const part of parts) dir = await dir.getDirectoryHandle(part, { create: true });
  const file = await dir.getFileHandle(name, { create: true });
  const writable = await file.createWritable();
  try {
    await writable.write(text);
  } finally {
    await writable.close();
  }
}

/**
 * Writes the files in order and stops at the first one that fails, so what comes later is never written
 * on top of something that is not there yet. 'needs-pin' when the server wants the PIN (nothing is lost:
 * the whole list can be sent again). Without a way to write, every file is downloaded.
 */
export async function saveFiles(source: BrowserLibrary, access: WriteAccess, files: readonly SaveFile[]): Promise<SaveFilesResult | 'needs-pin'> {
  const result: SaveFilesResult = { written: [], pending: files.map((file) => file.path) };
  const write = writer(source, access);
  if (!write) {
    download(files);
    return { ...result, reason: access === 'denied' ? 'denied' : 'no-folder' };
  }
  for (const file of files) {
    const outcome = await write(file);
    if (outcome === 'needs-pin') return 'needs-pin';
    if (outcome === 'failed') {
      const rest = files.slice(result.written.length);
      download(rest);
      return { ...result, reason: 'failed' };
    }
    result.written.push(file.path);
    result.pending.shift();
  }
  return result;
}

type Writer = (file: SaveFile) => Promise<'written' | 'failed' | 'needs-pin'>;

function writer(source: BrowserLibrary, access: WriteAccess): Writer | null {
  const editing: ServerEditing | undefined = source.editing;
  if (editing) {
    return async (file) => {
      const outcome = await editing.write(file.path, file.text, true);
      return outcome === 'written' ? 'written' : outcome === 'needs-pin' ? 'needs-pin' : 'failed';
    };
  }
  const handle = source.handle;
  if (access !== 'granted' || !handle) return null;
  return async (file) => {
    try {
      await overwriteInFolder(handle, file.path, file.text);
      return 'written';
    } catch {
      return 'failed';
    }
  };
}

/** One download per file, named like the file. */
export function download(files: readonly SaveFile[]): void {
  for (const file of files) downloadText(file.path.slice(file.path.lastIndexOf('/') + 1), file.text);
}
