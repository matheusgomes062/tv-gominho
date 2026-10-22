import type { Library } from '@tv-gominho/nucleo';
import { gradeFileBase, gradeFolderFiles, gradePath, planReplace } from '../wizard-model';
import { downloadText, type DownloadReason, type SaveResult, type WriteAccess } from './save';
import type { BrowserLibrary, ServerEditing } from './types';

// The one way the app overwrites a channel (the editor and "trocar canal" of the wizard): the grade file at `path`
// is replaced only after a copy of the old one was made next to it, as `<name>.AAAA-MM-DD.yaml.bak` (a name the
// library never loads as a channel, see nucleo backup.ts). Three destinations, picked by `pickDestination`:
// `tv-gominho servir --editar` (the server makes the copy itself, the client never writes a .bak path), the
// picked folder, or downloads of both files. If the copy cannot be made, the channel is not touched.

/** The result of overwriting a channel: as a save, plus the copy of the old file that was kept (or handed over). */
export type ReplaceResult = SaveResult & {
  replaces: true;
  /** The backup copy in grades/ (a download when the folder could not be written); null if the old file could not be read. */
  backupName: string | null;
  backupPath: string | null;
  /** The old file's text, kept for the download fallback. */
  backupYaml?: string;
};

export type Destination =
  | { kind: 'server'; editing: ServerEditing }
  | { kind: 'folder'; handle: FileSystemDirectoryHandle }
  | { kind: 'download'; reason: DownloadReason };

/** Where a save goes: the server when the library comes from `servir --editar`, else the folder with write access, else a download. */
export function pickDestination(source: Pick<BrowserLibrary, 'handle' | 'editing'>, access: WriteAccess): Destination {
  if (source.editing) return { kind: 'server', editing: source.editing };
  if (access === 'granted' && source.handle) return { kind: 'folder', handle: source.handle };
  return { kind: 'download', reason: access === 'denied' ? 'denied' : 'no-folder' };
}

/** The name the backup of `path` would get today, going by the grade files the library was read with (the real one can differ by a -N). */
export function expectedBackupName(source: Pick<BrowserLibrary, 'files'>, library: Pick<Library, 'root'>, path: string, today: string): string {
  return planReplace({ path }, today, gradeFolderFiles(source.files, library.root), library.root).backupName;
}

/**
 * Overwrites the grade file at `path` (as `Schedule.path` has it) with `yaml`, keeping the old text in a backup.
 * 'needs-pin' when the server wants the PIN (nothing was written; call again once paired).
 */
export async function overwriteWithBackup(
  source: BrowserLibrary,
  library: Library,
  access: WriteAccess,
  path: string,
  today: string,
  yaml: string,
): Promise<ReplaceResult | 'needs-pin'> {
  const destination = pickDestination(source, access);
  if (destination.kind === 'server') {
    const outcome = await destination.editing.replaceWithBackup(path, yaml);
    if (outcome.status === 'needs-pin') return 'needs-pin';
    if (outcome.status === 'written') {
      const backupPath = outcome.backup ?? null;
      return {
        kind: 'written',
        fileName: gradeFileBase(path),
        path,
        replaces: true,
        backupName: backupPath === null ? null : backupPath.slice(backupPath.lastIndexOf('/') + 1),
        backupPath,
      };
    }
    return downloadReplacement(source, library, path, today, yaml, 'failed');
  }
  if (destination.kind === 'folder') {
    try {
      return await overwriteInFolder(destination.handle, library.root, path, today, yaml);
    } catch {
      return downloadReplacement(source, library, path, today, yaml, 'failed');
    }
  }
  return downloadReplacement(source, library, path, today, yaml, destination.reason);
}

async function overwriteInFolder(handle: FileSystemDirectoryHandle, root: string, path: string, today: string, yaml: string): Promise<ReplaceResult> {
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
  const plan = planReplace({ path }, today, onDisk, root);
  const existing = onDisk.find((name) => gradeFileBase(name).toLowerCase() === plan.fileName.toLowerCase() && /\.ya?ml$/i.test(name));
  if (!existing) throw new Error('o arquivo do canal não está mais em grades/');

  const file = await grades.getFileHandle(existing);
  const before = await (await file.getFile()).text();
  const copy = await grades.getFileHandle(plan.backupName, { create: true });
  await writeText(copy, before);
  // Only overwrite once the copy reads back the same.
  if ((await (await copy.getFile()).text()) !== before) throw new Error('a cópia de segurança não confere');

  await writeText(file, yaml);
  return {
    kind: 'written',
    fileName: gradeFileBase(existing),
    path: gradePath(root, gradeFileBase(existing)),
    replaces: true,
    backupName: plan.backupName,
    backupPath: plan.backupPath,
  };
}

export async function writeText(file: FileSystemFileHandle, text: string): Promise<void> {
  const writable = await file.createWritable();
  try {
    await writable.write(text);
  } finally {
    await writable.close();
  }
}

async function downloadReplacement(source: BrowserLibrary, library: Library, path: string, today: string, yaml: string, reason: DownloadReason): Promise<ReplaceResult> {
  const plan = planReplace({ path }, today, gradeFolderFiles(source.files, library.root), library.root);
  const before = await source.readText(path).catch(() => null);
  // The new file keeps the old one's extension (.yml too), or the library would end up with two channels of the same name.
  const file = `${plan.fileName}${/\.ya?ml$/i.exec(path)?.[0] ?? '.yaml'}`;
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
