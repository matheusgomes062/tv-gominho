import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { scanLibrary } from '@tv-gominho/nucleo';
import { openNodeLibrary, resolveInside } from './node-source';

let dir: string;

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'tv-gominho-'));
  const files = [
    'biblioteca/programas/show/programa.yaml',
    'biblioteca/programas/show/episodios/001 - Um.mp4',
    'biblioteca/programas/show/episodios/002.avi',
    'biblioteca/programas/show/.escondido.mp4',
    'biblioteca/.originais/programas/show/003.avi',
    '$RECYCLE.BIN/lixo.mp4',
    'System Volume Information/x.dat',
  ];
  for (const file of files) {
    await mkdir(path.dirname(path.join(dir, file)), { recursive: true });
    await writeFile(path.join(dir, file), file.endsWith('.yaml') ? 'titulo: Show\n' : 'x');
  }
});

afterAll(() => rm(dir, { recursive: true, force: true }));

describe('openNodeLibrary', () => {
  it('lists files with / separators, skipping dotfiles and system folders', async () => {
    const source = await openNodeLibrary(dir);
    expect([...source.files].sort()).toEqual([
      'biblioteca/programas/show/episodios/001 - Um.mp4',
      'biblioteca/programas/show/episodios/002.avi',
      'biblioteca/programas/show/programa.yaml',
    ]);
  });

  it('works with scanLibrary, finding the biblioteca/ folder', async () => {
    const library = await scanLibrary(await openNodeLibrary(dir));
    expect(library.root).toBe('biblioteca/');
    expect(library.shows[0]?.title).toBe('Show');
    expect(library.warnings.some((warning) => warning.path?.endsWith('002.avi'))).toBe(true);
  });

  it('reads text files and rejects missing folders', async () => {
    const source = await openNodeLibrary(dir);
    expect(await source.readText('biblioteca/programas/show/programa.yaml')).toBe('titulo: Show\n');
    await expect(openNodeLibrary(path.join(dir, 'nope'))).rejects.toThrow(/não existe/);
  });
});

describe('resolveInside', () => {
  it('stays inside the library folder', () => {
    expect(resolveInside(dir, 'a/b.mp4')).toBe(path.join(dir, 'a', 'b.mp4'));
    expect(() => resolveInside(dir, '../fora.mp4')).toThrow(/fora da biblioteca/);
    expect(() => resolveInside(dir, 'a/../../fora.mp4')).toThrow(/fora da biblioteca/);
  });
});
