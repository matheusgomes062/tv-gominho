import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BrowserLibrary } from './types';

const downloads: Array<[string, string]> = [];
vi.mock('./save', () => ({ downloadText: (name: string, text: string) => downloads.push([name, text]) }));

const { overwriteGrade } = await import('./overwrite');

/** A folder tree in memory: { "grades": { "x.yaml": "text" } }; only the calls overwriteGrade makes. */
type Tree = { [name: string]: string | Tree };
function dirHandle(tree: Tree): FileSystemDirectoryHandle {
  return {
    async getDirectoryHandle(name: string) {
      const entry = tree[name];
      if (typeof entry !== 'object') throw new DOMException('not found', 'NotFoundError');
      return dirHandle(entry);
    },
    async getFileHandle(name: string) {
      if (typeof tree[name] !== 'string') throw new DOMException('not found', 'NotFoundError');
      return {
        async createWritable() {
          return {
            async write(text: string) {
              tree[name] = text;
            },
            async close() {},
          };
        },
      };
    },
  } as unknown as FileSystemDirectoryHandle;
}

const source = (tree: Tree | null): BrowserLibrary => ({ handle: tree ? dirHandle(tree) : undefined }) as unknown as BrowserLibrary;

beforeEach(() => {
  downloads.length = 0;
});

describe('overwriteGrade', () => {
  it('replaces the grade file that was opened, and nothing else', async () => {
    const tree: Tree = { biblioteca: { grades: { 'a.yaml': 'old a', 'b.yaml': 'old b' } } };
    const result = await overwriteGrade(source(tree), 'granted', 'biblioteca/grades/a.yaml', 'new a');
    expect(result).toEqual({ kind: 'written', fileName: 'a', path: 'biblioteca/grades/a.yaml' });
    expect(tree).toEqual({ biblioteca: { grades: { 'a.yaml': 'new a', 'b.yaml': 'old b' } } });
    expect(downloads).toEqual([]);
  });

  it('does not create a file that is not there: it downloads instead', async () => {
    const tree: Tree = { grades: {} };
    const result = await overwriteGrade(source(tree), 'granted', 'grades/gone.yaml', 'text');
    expect(result).toMatchObject({ kind: 'downloaded', fileName: 'gone', reason: 'failed', yaml: 'text' });
    expect(tree).toEqual({ grades: {} });
    expect(downloads).toEqual([['gone.yaml', 'text']]);
  });

  it('downloads the file under the same name without write access', async () => {
    expect(await overwriteGrade(source(null), 'unavailable', 'grades/a.yaml', 'text')).toMatchObject({ kind: 'downloaded', reason: 'no-folder' });
    expect(await overwriteGrade(source({ grades: { 'a.yaml': 'old' } }), 'denied', 'grades/a.yaml', 'text')).toMatchObject({ kind: 'downloaded', reason: 'denied' });
    expect(downloads).toEqual([
      ['a.yaml', 'text'],
      ['a.yaml', 'text'],
    ]);
  });
});
