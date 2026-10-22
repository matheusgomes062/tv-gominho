import type { Library } from '@tv-gominho/nucleo';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BrowserLibrary, ServerEditing } from './types';

const downloads: Array<[string, string]> = [];
vi.mock('./save', () => ({ downloadText: (name: string, text: string) => downloads.push([name, text]) }));

const { expectedBackupName, overwriteWithBackup, pickDestination } = await import('./overwrite');

/** A folder tree in memory: { "grades": { "x.yaml": "text" } }; only the calls the save makes. */
type Tree = { [name: string]: string | Tree };
function dirHandle(tree: Tree, options: { dropWrites?: RegExp } = {}): FileSystemDirectoryHandle {
  return {
    async getDirectoryHandle(name: string) {
      const entry = tree[name];
      if (typeof entry !== 'object') throw new DOMException('not found', 'NotFoundError');
      return dirHandle(entry, options);
    },
    async getFileHandle(name: string, create?: { create?: boolean }) {
      if (typeof tree[name] !== 'string') {
        if (!create?.create) throw new DOMException('not found', 'NotFoundError');
        tree[name] = '';
      }
      return {
        async getFile() {
          return { async text() { return tree[name] as string; } };
        },
        async createWritable() {
          return {
            async write(text: string) {
              if (!options.dropWrites?.test(name)) tree[name] = text;
            },
            async close() {},
          };
        },
      };
    },
    async *values() {
      for (const [name, entry] of Object.entries(tree)) yield { kind: typeof entry === 'string' ? 'file' : 'directory', name, ...(typeof entry === 'object' ? dirHandle(entry, options) : {}) };
    },
  } as unknown as FileSystemDirectoryHandle;
}

const library = { root: 'biblioteca/' } as Library;
const TODAY = '2026-10-22';

function source(parts: { tree?: Tree; editing?: ServerEditing; files?: string[]; dropWrites?: RegExp; text?: string | null }): BrowserLibrary {
  return {
    handle: parts.tree ? dirHandle(parts.tree, { dropWrites: parts.dropWrites }) : undefined,
    editing: parts.editing,
    files: parts.files ?? [],
    readText: async () => {
      if (parts.text === null) throw new Error('gone');
      return parts.text ?? 'old text';
    },
  } as unknown as BrowserLibrary;
}

function server(replace: ServerEditing['replaceWithBackup']): ServerEditing {
  return { pair: async () => 'paired', write: async () => 'failed', replaceWithBackup: vi.fn(replace) };
}

beforeEach(() => {
  downloads.length = 0;
});

describe('pickDestination', () => {
  const handle = {} as FileSystemDirectoryHandle;
  const editing = server(async () => ({ status: 'written' }));

  it('prefers the server, then a folder with write access, then a download', () => {
    expect(pickDestination({ editing }, 'unavailable').kind).toBe('server');
    expect(pickDestination({ handle, editing }, 'granted').kind).toBe('server');
    expect(pickDestination({ handle }, 'granted').kind).toBe('folder');
  });

  it('downloads with the reason when the folder cannot be written', () => {
    expect(pickDestination({ handle }, 'denied')).toEqual({ kind: 'download', reason: 'denied' });
    expect(pickDestination({ handle }, 'unavailable')).toEqual({ kind: 'download', reason: 'no-folder' });
    expect(pickDestination({}, 'granted')).toEqual({ kind: 'download', reason: 'no-folder' });
  });
});

describe('overwriteWithBackup into the folder', () => {
  it('copies the old file to a .bak with the same text, then overwrites it, and nothing else changes', async () => {
    const tree: Tree = { biblioteca: { grades: { 'a.yaml': 'old a', 'b.yaml': 'old b' } } };
    const result = await overwriteWithBackup(source({ tree }), library, 'granted', 'biblioteca/grades/a.yaml', TODAY, 'new a');
    expect(result).toEqual({
      kind: 'written',
      fileName: 'a',
      path: 'biblioteca/grades/a.yaml',
      replaces: true,
      backupName: 'a.2026-10-22.yaml.bak',
      backupPath: 'biblioteca/grades/a.2026-10-22.yaml.bak',
    });
    expect(tree).toEqual({ biblioteca: { grades: { 'a.yaml': 'new a', 'b.yaml': 'old b', 'a.2026-10-22.yaml.bak': 'old a' } } });
    expect(downloads).toEqual([]);
  });

  it('takes the next free backup name, going by what is in the folder', async () => {
    const tree: Tree = { biblioteca: { grades: { 'a.yaml': 'old a', 'a.2026-10-22.yaml.bak': 'older' } } };
    const result = await overwriteWithBackup(source({ tree }), library, 'granted', 'biblioteca/grades/a.yaml', TODAY, 'new a');
    expect(result).toMatchObject({ kind: 'written', backupName: 'a.2026-10-22-2.yaml.bak' });
    expect(tree).toEqual({ biblioteca: { grades: { 'a.yaml': 'new a', 'a.2026-10-22.yaml.bak': 'older', 'a.2026-10-22-2.yaml.bak': 'old a' } } });
  });

  it('does not touch the channel when the copy does not read back the same, and downloads both files', async () => {
    const tree: Tree = { biblioteca: { grades: { 'a.yaml': 'old a' } } };
    const result = await overwriteWithBackup(source({ tree, dropWrites: /\.bak$/ }), library, 'granted', 'biblioteca/grades/a.yaml', TODAY, 'new a');
    expect(result).toMatchObject({ kind: 'downloaded', reason: 'failed' });
    expect((tree.biblioteca as Tree).grades).toMatchObject({ 'a.yaml': 'old a' });
    expect(downloads.map(([name]) => name)).toEqual(['a.2026-10-22.yaml.bak', 'a.yaml']);
  });

  it('downloads when the channel file is no longer there', async () => {
    const tree: Tree = { biblioteca: { grades: {} } };
    const result = await overwriteWithBackup(source({ tree }), library, 'granted', 'biblioteca/grades/gone.yaml', TODAY, 'new');
    expect(result).toMatchObject({ kind: 'downloaded', reason: 'failed' });
    expect(tree).toEqual({ biblioteca: { grades: {} } });
  });
});

describe('overwriteWithBackup as a download', () => {
  it('hands over the old text as the backup and the new text under the same name, with the extension it had', async () => {
    const result = await overwriteWithBackup(source({ text: 'old', files: ['biblioteca/grades/a.yml'] }), library, 'unavailable', 'biblioteca/grades/a.yml', TODAY, 'new');
    expect(result).toMatchObject({
      kind: 'downloaded',
      reason: 'no-folder',
      path: 'biblioteca/grades/a.yml',
      backupName: 'a.2026-10-22.yaml.bak',
      backupYaml: 'old',
      yaml: 'new',
    });
    expect(downloads).toEqual([
      ['a.2026-10-22.yaml.bak', 'old'],
      ['a.yml', 'new'],
    ]);
  });

  it('says denied when the person refused the permission, and skips the backup when the old file cannot be read', async () => {
    const result = await overwriteWithBackup(source({ text: null, tree: {} }), library, 'denied', 'biblioteca/grades/a.yaml', TODAY, 'new');
    expect(result).toMatchObject({ kind: 'downloaded', reason: 'denied', backupName: null, backupPath: null });
    expect(downloads).toEqual([['a.yaml', 'new']]);
  });

  it('avoids a backup name already in grades/', () => {
    expect(expectedBackupName({ files: ['biblioteca/grades/a.2026-10-22.yaml.bak'] }, library, 'biblioteca/grades/a.yaml', TODAY)).toBe('a.2026-10-22-2.yaml.bak');
  });
});

describe('overwriteWithBackup through the server', () => {
  it('sends the channel path only (the server makes the copy) and reports the copy it made', async () => {
    const editing = server(async () => ({ status: 'written', backup: 'biblioteca/grades/a.2026-10-22.yaml.bak' }));
    const tree: Tree = { biblioteca: { grades: { 'a.yaml': 'old' } } };
    const result = await overwriteWithBackup(source({ editing, tree }), library, 'granted', 'biblioteca/grades/a.yaml', TODAY, 'new');
    expect(editing.replaceWithBackup).toHaveBeenCalledWith('biblioteca/grades/a.yaml', 'new');
    expect(result).toEqual({
      kind: 'written',
      fileName: 'a',
      path: 'biblioteca/grades/a.yaml',
      replaces: true,
      backupName: 'a.2026-10-22.yaml.bak',
      backupPath: 'biblioteca/grades/a.2026-10-22.yaml.bak',
    });
    // The folder is left alone even when it could be written.
    expect(tree).toEqual({ biblioteca: { grades: { 'a.yaml': 'old' } } });
  });

  it('asks for the PIN, writing nothing', async () => {
    const editing = server(async () => ({ status: 'needs-pin' }));
    expect(await overwriteWithBackup(source({ editing }), library, 'unavailable', 'grades/a.yaml', TODAY, 'new')).toBe('needs-pin');
    expect(downloads).toEqual([]);
  });

  it('falls back to downloads when the server fails', async () => {
    const editing = server(async () => ({ status: 'failed' }));
    const result = await overwriteWithBackup(source({ editing, text: 'old' }), library, 'unavailable', 'biblioteca/grades/a.yaml', TODAY, 'new');
    expect(result).toMatchObject({ kind: 'downloaded', reason: 'failed', backupName: 'a.2026-10-22.yaml.bak' });
    expect(downloads).toHaveLength(2);
  });
});
