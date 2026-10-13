import { fileBackedLibrary, type BrowserLibrary } from './types';

// Folders that USB sticks and Windows drives carry and that can't be read.
const SKIPPED_FOLDERS = new Set(['$recycle.bin', 'system volume information', 'node_modules']);

/** True in Chrome/Edge on desktop: the folder can be remembered between visits. */
export const canRememberFolder = typeof window !== 'undefined' && 'showDirectoryPicker' in window;

export async function pickFolder(): Promise<FileSystemDirectoryHandle> {
  return window.showDirectoryPicker!({ id: 'tv-chuvisco-biblioteca', mode: 'read' });
}

/** Reads every file path in a folder picked with showDirectoryPicker. */
export async function openFolder(root: FileSystemDirectoryHandle): Promise<BrowserLibrary> {
  const handles = new Map<string, FileSystemFileHandle>();

  async function walk(dir: FileSystemDirectoryHandle, prefix: string) {
    for await (const handle of dir.values()) {
      if (handle.name.startsWith('.')) continue;
      const path = prefix ? `${prefix}/${handle.name}` : handle.name;
      if (handle.kind === 'file') {
        handles.set(path, handle as FileSystemFileHandle);
      } else if (!SKIPPED_FOLDERS.has(handle.name.toLowerCase())) {
        try {
          await walk(handle as FileSystemDirectoryHandle, path);
        } catch {
          // Unreadable folder (permissions, system folder): skip it.
        }
      }
    }
  }
  await walk(root, '');

  const files = new Map<string, File>();
  return fileBackedLibrary(root.name, [...handles.keys()], async (path) => {
    let file = files.get(path);
    if (!file) {
      const handle = handles.get(path);
      if (!handle) throw new Error(`Arquivo não encontrado: ${path}`);
      file = await handle.getFile();
      files.set(path, file);
    }
    return file;
  });
}

/** Fallback for browsers without showDirectoryPicker: <input type="file" webkitdirectory>. */
export function openFileList(list: FileList): BrowserLibrary | null {
  const files = new Map<string, File>();
  let name = '';
  for (const file of Array.from(list)) {
    // webkitRelativePath is "<picked folder>/<path inside it>".
    const [top, ...rest] = file.webkitRelativePath.split('/');
    name = top ?? name;
    const path = rest.join('/');
    if (!path || rest.some((part) => part.startsWith('.'))) continue;
    files.set(path, file);
  }
  if (files.size === 0) return null;
  return fileBackedLibrary(name, [...files.keys()], async (path) => {
    const file = files.get(path);
    if (!file) throw new Error(`Arquivo não encontrado: ${path}`);
    return file;
  });
}

// The last folder handle is kept in IndexedDB so "Abrir de novo" works after a reload.
const DB_NAME = 'tv-chuvisco';
const STORE = 'pastas';
const KEY = 'biblioteca';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function rememberFolder(handle: FileSystemDirectoryHandle): Promise<void> {
  try {
    const db = await openDb();
    db.transaction(STORE, 'readwrite').objectStore(STORE).put(handle, KEY);
  } catch {
    // Private mode or storage blocked: the folder just won't be remembered.
  }
}

export async function rememberedFolder(): Promise<FileSystemDirectoryHandle | undefined> {
  try {
    const db = await openDb();
    return await new Promise((resolve) => {
      const request = db.transaction(STORE, 'readonly').objectStore(STORE).get(KEY);
      request.onsuccess = () => resolve(request.result as FileSystemDirectoryHandle | undefined);
      request.onerror = () => resolve(undefined);
    });
  } catch {
    return undefined;
  }
}

/** Asks the browser to read the remembered folder again. Must run inside a click. */
export async function regainAccess(handle: FileSystemDirectoryHandle): Promise<boolean> {
  const options = { mode: 'read' } as const;
  if ((await handle.queryPermission?.(options)) === 'granted') return true;
  return (await handle.requestPermission?.(options)) === 'granted';
}
