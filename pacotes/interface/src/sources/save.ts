import { scanLibrary, type Library, type Schedule } from '@tv-gominho/nucleo';
import { gradeFileBase, gradeFolderFiles, gradePath, planReplace, uniqueFileName } from '../wizard-model';
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

// ---------------------------------------------------------------- replacing a channel

/** The result of replacing a channel: as a save, plus the copy of the old file that was kept (or handed over). */
export type ReplaceResult = SaveResult & {
  replaces: true;
  /** The backup copy in grades/ (a download when the folder could not be written); null if the old file could not be read. */
  backupName: string | null;
  backupPath: string | null;
  /** The old file's text, kept for the download fallback. */
  backupYaml?: string;
};

/**
 * Writes `yaml` over the grade file of `channel`: the only place the app overwrites a channel, and only after the
 * person confirmed it. Before that the old file is copied to `<name>.<date>.yaml.bak` in the same folder (a name the
 * library never loads as a channel, see nucleo backup.ts); if the copy cannot be made, the channel is not touched.
 * Without write access both files are downloaded instead and the person puts them in place.
 */
export async function replaceGrade(
  source: BrowserLibrary,
  library: Library,
  access: WriteAccess,
  channel: Schedule,
  today: string,
  yaml: string,
): Promise<ReplaceResult> {
  if (access === 'granted' && source.handle) {
    try {
      return await overwriteInFolder(source.handle, library.root, channel, today, yaml);
    } catch {
      return downloadReplacement(source, library, channel, today, yaml, 'failed');
    }
  }
  return downloadReplacement(source, library, channel, today, yaml, access === 'denied' ? 'denied' : 'no-folder');
}

async function overwriteInFolder(handle: FileSystemDirectoryHandle, root: string, channel: Schedule, today: string, yaml: string): Promise<ReplaceResult> {
  let dir = handle;
  for (const part of root.split('/').filter(Boolean)) dir = await dir.getDirectoryHandle(part);
  let grades: FileSystemDirectoryHandle | undefined;
  for await (const entry of dir.values()) {
    if (entry.kind === 'directory' && entry.name.toLowerCase() === 'grades') grades = entry as FileSystemDirectoryHandle;
  }
  if (!grades) throw new Error('grades/ não existe');
  const onDisk: string[] = [];
  for await (const entry of grades.values()) if (entry.kind === 'file') onDisk.push(entry.name);

  // The folder is the truth about which file is the channel's, and about which backup names are free.
  const plan = planReplace(channel, today, onDisk, root);
  const existing = onDisk.find((name) => gradeFileBase(name).toLowerCase() === plan.fileName.toLowerCase() && /\.ya?ml$/i.test(name));
  if (!existing) throw new Error('o arquivo do canal não está mais em grades/');

  const file = await grades.getFileHandle(existing);
  const before = await (await file.getFile()).text();
  const copy = await grades.getFileHandle(plan.backupName, { create: true });
  await writeText(copy, before);
  // Only overwrite once the copy reads back the same.
  if ((await (await copy.getFile()).text()) !== before) throw new Error('a cópia de segurança não confere');

  await writeText(file, yaml);
  return { kind: 'written', fileName: gradeFileBase(existing), path: gradePath(root, gradeFileBase(existing)), replaces: true, backupName: plan.backupName, backupPath: plan.backupPath };
}

async function writeText(file: FileSystemFileHandle, text: string): Promise<void> {
  const writable = await file.createWritable();
  try {
    await writable.write(text);
  } finally {
    await writable.close();
  }
}

async function downloadReplacement(
  source: BrowserLibrary,
  library: Library,
  channel: Schedule,
  today: string,
  yaml: string,
  reason: DownloadReason,
): Promise<ReplaceResult> {
  const plan = planReplace(channel, today, gradeFolderFiles(source.files, library.root), library.root);
  const before = await source.readText(channel.path).catch(() => null);
  // The new file keeps the old one's extension (.yml too), or the library would end up with two channels of the same name.
  const file = `${plan.fileName}${/\.ya?ml$/i.exec(channel.path)?.[0] ?? '.yaml'}`;
  if (before !== null) downloadText(plan.backupName, before);
  downloadText(file, yaml);
  return {
    kind: 'downloaded',
    fileName: plan.fileName,
    path: `${library.root}grades/${file}`,
    reason,
    yaml,
    replaces: true,
    backupName: before === null ? null : plan.backupName,
    backupPath: before === null ? null : plan.backupPath,
    ...(before === null ? {} : { backupYaml: before }),
  };
}

