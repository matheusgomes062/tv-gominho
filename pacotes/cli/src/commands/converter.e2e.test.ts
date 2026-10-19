import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { scanLibrary } from '@tv-gominho/nucleo';
import { locateFfmpeg, probe } from '../ffmpeg';
import { openNodeLibrary } from '../node-source';
import { converterCommand } from './converter';

// Real conversions with a real ffmpeg. Skipped when ffmpeg is not installed.
const hasFfmpeg = ['ffmpeg', 'ffprobe'].every((tool) => spawnSync(tool, ['-version'], { stdio: 'ignore' }).status === 0);

let root: string;

function ffmpeg(args: string[]) {
  const result = spawnSync('ffmpeg', ['-v', 'error', '-y', ...args], { stdio: 'ignore' });
  if (result.status !== 0) throw new Error(`ffmpeg failed: ${args.join(' ')}`);
}

const sources = (seconds: number) => [
  '-f', 'lavfi', '-i', `testsrc2=size=320x240:rate=25:duration=${seconds}`,
  '-f', 'lavfi', '-i', `sine=frequency=440:sample_rate=44100:duration=${seconds}`,
];

async function makeLibrary(name: string, files: Record<string, string[]>) {
  const library = path.join(root, name);
  for (const [file, args] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(library, file)), { recursive: true });
    ffmpeg([...args, path.join(library, file)]);
  }
  await writeFile(path.join(library, 'programas', 'show', 'programa.yaml'), 'titulo: Show\n');
  return library;
}

async function listAll(dir: string, prefix = ''): Promise<string[]> {
  const found: string[] = [];
  for (const entry of await readdir(path.join(dir, prefix), { withFileTypes: true })) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) found.push(...(await listAll(dir, relative)));
    else found.push(relative);
  }
  return found.sort();
}

describe.skipIf(!hasFfmpeg)('converter (real ffmpeg)', { timeout: 60_000 }, () => {
  beforeAll(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'tv-gominho-e2e-'));
  });
  afterAll(() => rm(root, { recursive: true, force: true }));
  afterEach(() => vi.restoreAllMocks());

  const quiet = () => vi.spyOn(console, 'log').mockImplementation(() => undefined);

  it('converts old and incompatible files, moves the originals and leaves nothing for the scan to warn about', async () => {
    quiet();
    const library = await makeLibrary('completa', {
      'programas/show/episodios/001.avi': [...sources(2), '-c:v', 'mpeg4', '-c:a', 'libmp3lame'],
      'programas/show/episodios/002.mkv': [...sources(2), '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac'],
      'programas/show/episodios/003.mp4': [...sources(2), '-c:v', 'libx265', '-c:a', 'aac'],
      'programas/show/episodios/004.mp4': [...sources(2), '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac'],
    });

    expect(await converterCommand.run([library, '--preset', 'ultrafast', '--simular'], { signal: new AbortController().signal })).toBe(0);
    expect(await listAll(library)).toContain('programas/show/episodios/001.avi');

    expect(await converterCommand.run([library, '--preset', 'ultrafast'], { signal: new AbortController().signal })).toBe(0);
    expect(await listAll(library)).toEqual([
      '.originais/programas/show/episodios/001.avi',
      '.originais/programas/show/episodios/002.mkv',
      '.originais/programas/show/episodios/003.mp4',
      'programas/show/episodios/001.mp4',
      'programas/show/episodios/002.mp4',
      'programas/show/episodios/003.mp4',
      'programas/show/episodios/004.mp4',
      'programas/show/programa.yaml',
    ]);

    const tools = await locateFfmpeg();
    for (const name of ['001', '002', '003']) {
      const info = await probe(tools, path.join(library, `programas/show/episodios/${name}.mp4`));
      expect(info.video?.codec).toBe('h264');
      expect(info.audio[0]?.codec).toBe('aac');
      expect(info.duration).toBeCloseTo(2, 0);
    }

    const scanned = await scanLibrary(await openNodeLibrary(library));
    expect(scanned.shows[0]?.episodes).toHaveLength(4);
    expect(scanned.warnings.filter((warning) => /suportado/.test(warning.message))).toEqual([]);

    // A second run has nothing left to do.
    expect(await converterCommand.run([library], { signal: new AbortController().signal })).toBe(0);
  });

  it('refuses folders that are not libraries', async () => {
    const folder = path.join(root, 'qualquer');
    await mkdir(folder, { recursive: true });
    ffmpeg([...sources(1), '-c:v', 'mpeg4', path.join(folder, 'video.avi')]);
    await expect(converterCommand.run([folder], { signal: new AbortController().signal })).rejects.toThrow(/não parece ser uma biblioteca/);
    expect(existsSync(path.join(folder, 'video.avi'))).toBe(true);
  });

  it('on Ctrl+C removes the partial file and leaves the original alone', async () => {
    quiet();
    const library = await makeLibrary('cancelar', {
      'programas/show/episodios/001.avi': [...sources(120), '-c:v', 'mpeg4', '-q:v', '2', '-c:a', 'libmp3lame'],
    });
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 700);
    const code = await converterCommand.run([library, '--preset', 'veryslow'], { signal: controller.signal });
    expect(code).toBe(130);
    expect(await listAll(library)).toEqual(['programas/show/episodios/001.avi', 'programas/show/programa.yaml']);
  });

  it('keeps the original and reports a failure for a corrupt file', async () => {
    quiet();
    const library = await makeLibrary('quebrado', {
      'programas/show/episodios/001.mkv': [...sources(2), '-c:v', 'libx264', '-c:a', 'aac'],
    });
    await writeFile(path.join(library, 'programas/show/episodios/002.avi'), 'isto não é um vídeo');
    expect(await converterCommand.run([library, '--preset', 'ultrafast'], { signal: new AbortController().signal })).toBe(1);
    const files = await listAll(library);
    expect(files).toContain('programas/show/episodios/002.avi');
    expect(files).toContain('programas/show/episodios/001.mp4');
    expect(files.some((file) => file.includes('parcial'))).toBe(false);
  });

  it('--apagar-originais deletes the original only after a valid conversion', async () => {
    quiet();
    const library = await makeLibrary('apagar', {
      'programas/show/episodios/001.avi': [...sources(2), '-c:v', 'mpeg4', '-c:a', 'libmp3lame'],
    });
    expect(await converterCommand.run([library, '--apagar-originais', '--preset', 'ultrafast'], { signal: new AbortController().signal })).toBe(0);
    expect(await listAll(library)).toEqual(['programas/show/episodios/001.mp4', 'programas/show/programa.yaml']);
  });
});
