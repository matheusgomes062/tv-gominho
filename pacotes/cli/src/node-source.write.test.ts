import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { resolveForWrite } from './node-source';

const base = mkdtempSync(path.join(tmpdir(), 'tv-chuvisco-write-'));
const library = path.join(base, 'biblioteca');
const outside = path.join(base, 'fora');
mkdirSync(path.join(library, 'programas', 'a'), { recursive: true });
mkdirSync(outside);
// A junction needs no admin rights on Windows; elsewhere it's a plain symlink.
symlinkSync(outside, path.join(library, '.originais'), 'junction');
afterAll(() => rmSync(base, { recursive: true, force: true }));

describe('resolveForWrite', () => {
  it('allows ordinary paths, existing or not', async () => {
    expect(await resolveForWrite(library, 'programas/a/novo.mp4')).toBe(path.join(library, 'programas', 'a', 'novo.mp4'));
    expect(await resolveForWrite(library, 'nova/pasta/x.mp4')).toBe(path.join(library, 'nova', 'pasta', 'x.mp4'));
  });

  it('refuses writing through a link that leads outside the library', async () => {
    await expect(resolveForWrite(library, '.originais/programas/a/1.avi')).rejects.toThrow(/link simbólico/);
  });

  it('refuses paths that escape the folder', async () => {
    await expect(resolveForWrite(library, '../fora/x.mp4')).rejects.toThrow(/fora da biblioteca/);
  });
});
