import { scanLibrary, type Library } from '@tv-gominho/nucleo';
import { gradePath, uniqueFileName } from '../wizard-model';
import { openFolder } from './folder';
import { openServerLibrary } from './server';
import type { BrowserLibrary, ServerEditing } from './types';

// Saving a new channel (a grade file in grades/): straight into the library folder when the browser
// allows it (Chrome/Edge with a remembered folder, write permission asked only now), through
// `tv-gominho servir --editar` after pairing with its PIN, or as a download.

export type WriteAccess = 'granted' | 'denied' | 'unavailable';

/** Why the file was downloaded instead of written into the folder. */
export type DownloadReason = 'no-folder' | 'denied' | 'failed';

export type SaveResult =
  | { kind: 'written'; fileName: string; path: string }
  | { kind: 'downloaded'; fileName: string; path: string; reason: DownloadReason; yaml: string };

/**
 * Asks for write permission on the library folder. This is the only place that does, and it must run
 * straight from the click on "Salvar" (a permission prompt needs a user gesture). 'unavailable' when
 * there is nothing to write into: the folder was not opened with the picker, or the browser lacks the API.
 */
export async function requestWriteAccess(source: BrowserLibrary): Promise<WriteAccess> {
  const handle = source.handle;
  if (!handle?.requestPermission) return 'unavailable';
  const options = { mode: 'readwrite' } as const;
  try {
    if ((await handle.queryPermission?.(options)) === 'granted') return 'granted';
    return (await handle.requestPermission(options)) === 'granted' ? 'granted' : 'denied';
  } catch {
    return 'denied';
  }
}

/**
 * Saves the grade as a new file of grades/, named after `name`, never over an existing one. With write
 * access it writes into the folder; otherwise (or if writing fails) it downloads the file.
 */
export async function saveGrade(
  source: BrowserLibrary,
  library: Library,
  access: WriteAccess,
  name: string,
  yaml: string,
  taken: readonly string[],
): Promise<SaveResult> {
  if (access === 'granted' && source.handle) {
    try {
      return await writeIntoFolder(source.handle, library.root, name, yaml, taken);
    } catch {
      return download(library.root, uniqueFileName(name, taken), yaml, 'failed');
    }
  }
  return download(library.root, uniqueFileName(name, taken), yaml, access === 'denied' ? 'denied' : 'no-folder');
}

async function writeIntoFolder(
  handle: FileSystemDirectoryHandle,
  root: string,
  name: string,
  yaml: string,
  taken: readonly string[],
): Promise<SaveResult> {
  let dir = handle;
  for (const part of root.split('/').filter(Boolean)) dir = await dir.getDirectoryHandle(part);

  // grades/ may be spelled in other case, or be missing; the library is read case-insensitively.
  let grades: FileSystemDirectoryHandle | undefined;
  const onDisk: string[] = [];
  for await (const entry of dir.values()) {
    if (entry.kind === 'directory' && entry.name.toLowerCase() === 'grades') grades = entry as FileSystemDirectoryHandle;
  }
  grades ??= await dir.getDirectoryHandle('grades', { create: true });
  for await (const entry of grades.values()) if (entry.kind === 'file') onDisk.push(entry.name);

  // The folder is the truth: a file added after the library was read still must not be overwritten.
  const fileName = uniqueFileName(name, [...taken, ...onDisk]);
  const file = await grades.getFileHandle(`${fileName}.yaml`, { create: true });
  const writable = await file.createWritable();
  try {
    await writable.write(yaml);
  } finally {
    await writable.close();
  }
  return { kind: 'written', fileName, path: gradePath(root, fileName) };
}

/** How many taken names saving through the server steps over before it gives up and downloads. */
const MAX_NAME_TRIES = 20;

/**
 * Saves the grade through `tv-gominho servir --editar`, as a new file of grades/ named after `name`.
 * 'needs-pin' when this device has to pair first (then call again); a download when the server fails.
 */
export async function saveThroughServer(
  editing: ServerEditing,
  library: Library,
  name: string,
  yaml: string,
  taken: readonly string[],
): Promise<SaveResult | 'needs-pin'> {
  // The server refuses to overwrite (409): a file added since the library was read gets the next name.
  const avoid = [...taken];
  for (let attempt = 0; attempt < MAX_NAME_TRIES; attempt++) {
    const fileName = uniqueFileName(name, avoid);
    const path = gradePath(library.root, fileName);
    const outcome = await editing.write(path, yaml);
    if (outcome === 'written') return { kind: 'written', fileName, path };
    if (outcome === 'needs-pin') return 'needs-pin';
    if (outcome === 'failed') break;
    avoid.push(fileName);
  }
  return download(library.root, uniqueFileName(name, avoid), yaml, 'failed');
}

function download(root: string, fileName: string, yaml: string, reason: DownloadReason): SaveResult {
  downloadText(`${fileName}.yaml`, yaml);
  return { kind: 'downloaded', fileName, path: gradePath(root, fileName), reason, yaml };
}

/** Hands a text file to the browser as a download. */
export function downloadText(filename: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/yaml;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  // The browser starts the download before this runs.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Reads the library again after a channel was written: the folder is walked and scanned from scratch. */
export async function rereadLibrary(source: BrowserLibrary): Promise<Library | null> {
  if (!source.handle && !source.editing) return null;
  const fresh = source.handle ? await openFolder(source.handle) : await openServerLibrary();
  try {
    return await scanLibrary(fresh);
  } finally {
    // Only its text was read; the videos keep coming from the source the session already has.
    fresh.dispose();
  }
}
