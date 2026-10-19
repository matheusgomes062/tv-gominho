import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { openNodeLibrary } from '../node-source';
import { copyLibrary, filesToCopy, isUpToDate } from './copy';
import { checkDestination, destPath, isInside } from './dest';

const base = mkdtempSync(path.join(tmpdir(), 'tv-gominho-dest-'));
const library = path.join(base, 'biblioteca');
const stick = path.join(base, 'pendrive');
const outside = path.join(base, 'fora');
mkdirSync(path.join(library, 'programas', 'show', 'episodios'), { recursive: true });
mkdirSync(path.join(library, 'vinhetas'), { recursive: true });
mkdirSync(path.join(library, '.originais', 'programas'), { recursive: true });
mkdirSync(stick);
mkdirSync(outside);
writeFileSync(path.join(library, 'programas', 'show', 'episodios', '001.mp4'), 'video one');
writeFileSync(path.join(library, 'programas', 'show', 'programa.yaml'), 'titulo: Show\n');
writeFileSync(path.join(library, 'configuracoes.yaml'), 'horario: real\n');
writeFileSync(path.join(library, '.originais', 'programas', 'velho.avi'), 'old');
writeFileSync(path.join(library, '.oculto'), 'x');
afterAll(() => rmSync(base, { recursive: true, force: true }));

describe('isInside', () => {
  it('is true for the folder itself and anything below it, false for siblings and parents', () => {
    const parent = path.resolve('/a/b');
    expect(isInside(parent, parent)).toBe(true);
    expect(isInside(path.join(parent, 'c', 'd'), parent)).toBe(true);
    expect(isInside(path.resolve('/a/bc'), parent)).toBe(false);
    expect(isInside(path.resolve('/a'), parent)).toBe(false);
  });
});

describe('checkDestination', () => {
  it('accepts a pendrive next to the library, existing or not yet created', async () => {
    expect(await checkDestination(stick, library)).toBe(stick);
    expect(await checkDestination(path.join(base, 'novo', 'pendrive'), library)).toBe(path.join(base, 'novo', 'pendrive'));
  });

  it('refuses the library itself and anything inside it, even through a link', async () => {
    await expect(checkDestination(library, library)).rejects.toThrow(/dentro da biblioteca/);
    await expect(checkDestination(path.join(library, 'saida'), library)).rejects.toThrow(/dentro da biblioteca/);
    await expect(checkDestination(path.join(library, 'a', 'b', 'c'), library)).rejects.toThrow(/dentro da biblioteca/);
    const link = path.join(base, 'atalho');
    symlinkSync(library, link, 'junction');
    await expect(checkDestination(link, library)).rejects.toThrow(/dentro da biblioteca/);
  });

  it('allows a destination that contains the library (the pendrive the library already lives on)', async () => {
    expect(await checkDestination(base, library)).toBe(base);
  });

  it('refuses a file', async () => {
    const file = path.join(base, 'arquivo.txt');
    writeFileSync(file, 'x');
    await expect(checkDestination(file, library)).rejects.toThrow(/não é uma pasta/);
  });
});

describe('destPath', () => {
  it('refuses to write through a link planted in the destination', async () => {
    const dest = path.join(base, 'destino-com-atalho');
    mkdirSync(dest);
    symlinkSync(outside, path.join(dest, 'ASSISTA AQUI'), 'junction');
    await expect(destPath(dest, 'ASSISTA AQUI', 'Dia 01 - Parte 1.mp4')).rejects.toThrow(/link simbólico/);
    expect(await destPath(dest, 'LEIA-ME.txt')).toBe(path.join(dest, 'LEIA-ME.txt'));
  });
});

describe('copyLibrary', () => {
  const quiet = new AbortController().signal;

  it('lists what the scan sees: no dotfiles, no .originais', async () => {
    const source = await openNodeLibrary(library);
    expect(filesToCopy(source.files, '').sort()).toEqual(['configuracoes.yaml', 'programas/show/episodios/001.mp4', 'programas/show/programa.yaml']);
  });

  it('copies the library into <destino>/biblioteca and skips what is already there', async () => {
    const source = await openNodeLibrary(library);
    const first = await copyLibrary(source, '', stick, quiet);
    expect(first).toMatchObject({ copied: 3, skipped: 0, failures: [], sameFolder: false, interrupted: false });
    expect(first.bytes).toBe('video one'.length + 'titulo: Show\n'.length + 'horario: real\n'.length);
    const second = await copyLibrary(source, '', stick, quiet);
    expect(second).toMatchObject({ copied: 0, skipped: 3 });
    // .originais and dotfiles stay behind.
    const copied = await openNodeLibrary(path.join(stick, 'biblioteca'));
    expect([...copied.files].sort()).toEqual(['configuracoes.yaml', 'programas/show/episodios/001.mp4', 'programas/show/programa.yaml']);
  });

  it('copies again when a file changed', async () => {
    const source = await openNodeLibrary(library);
    writeFileSync(path.join(library, 'configuracoes.yaml'), 'horario: continuo\ncrt:\n  ligado: false\n');
    const result = await copyLibrary(source, '', stick, quiet);
    expect(result).toMatchObject({ copied: 1, skipped: 2 });
  });

  it('does nothing when the pendrive is the library itself', async () => {
    const source = await openNodeLibrary(base);
    const result = await copyLibrary(source, 'biblioteca/', base, quiet);
    expect(result.sameFolder).toBe(true);
    expect(result.copied).toBe(0);
  });

  it('stops when interrupted', async () => {
    const source = await openNodeLibrary(library);
    const controller = new AbortController();
    controller.abort();
    const result = await copyLibrary(source, '', path.join(base, 'interrompido'), controller.signal);
    expect(result.interrupted).toBe(true);
    expect(result.copied).toBe(0);
  });
});

describe('isUpToDate', () => {
  it('compares size and date, with FAT precision', () => {
    expect(isUpToDate({ size: 10, mtimeMs: 1000 }, { size: 10, mtimeMs: 2000 })).toBe(true);
    expect(isUpToDate({ size: 10, mtimeMs: 1000 }, { size: 10, mtimeMs: 5000 })).toBe(false);
    expect(isUpToDate({ size: 10, mtimeMs: 1000 }, { size: 11, mtimeMs: 1000 })).toBe(false);
    expect(isUpToDate({ size: 10, mtimeMs: 1000 }, null)).toBe(false);
  });
});
