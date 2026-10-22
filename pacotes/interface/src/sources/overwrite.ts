import { gradeFileBase } from '../wizard-model';
import { downloadText, type DownloadReason, type SaveResult, type WriteAccess } from './save';
import type { BrowserLibrary } from './types';

// Saving an edited channel: the grade file that was opened is replaced by the new text. Unlike saveGrade (a new
// file, never over another), this one writes over an existing file on purpose, so it only ever touches `path`.

/**
 * Replaces the grade file at `path` (from the picked folder, as `Schedule.path` has it) with `yaml`. With write
 * access it writes into the folder; without it (or if writing fails) the file is downloaded under the same name,
 * for the person to put over the old one.
 */
export async function overwriteGrade(source: BrowserLibrary, access: WriteAccess, path: string, yaml: string): Promise<SaveResult> {
  const fileName = gradeFileBase(path);
  if (access === 'granted' && source.handle) {
    try {
      await writeOver(source.handle, path, yaml);
      return { kind: 'written', fileName, path };
    } catch {
      return download(fileName, path, yaml, 'failed');
    }
  }
  return download(fileName, path, yaml, access === 'denied' ? 'denied' : 'no-folder');
}

async function writeOver(handle: FileSystemDirectoryHandle, path: string, yaml: string): Promise<void> {
  const parts = path.split('/').filter(Boolean);
  const name = parts.pop();
  if (!name) throw new Error('Caminho vazio.');
  let dir = handle;
  for (const part of parts) dir = await dir.getDirectoryHandle(part);
  // Not created here: the file is the one the library was read from, and it must still be there.
  const file = await dir.getFileHandle(name);
  const writable = await file.createWritable();
  try {
    await writable.write(yaml);
  } finally {
    await writable.close();
  }
}

function download(fileName: string, path: string, yaml: string, reason: DownloadReason): SaveResult {
  downloadText(`${fileName}.yaml`, yaml);
  return { kind: 'downloaded', fileName, path, reason, yaml };
}
