import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { locateFfmpeg, probe, type FfmpegTools } from '../ffmpeg';
import { pendriveCommand } from './pendrive';

// Real renders with a real ffmpeg, on a tiny generated library. Skipped when ffmpeg is not installed.
const tools: FfmpegTools | null = await locateFfmpeg().catch(() => null);

let root: string;
let library: string;

function ffmpeg(args: string[]) {
  const result = spawnSync(tools!.ffmpeg, ['-v', 'error', '-y', ...args], { stdio: 'ignore' });
  if (result.status !== 0) throw new Error(`ffmpeg failed: ${args.join(' ')}`);
}

async function video(relative: string, seconds: number, options: { rate?: number; size?: string; tone?: number } = {}) {
  const file = path.join(library, relative);
  await mkdir(path.dirname(file), { recursive: true });
  ffmpeg([
    '-f', 'lavfi', '-i', `testsrc2=size=${options.size ?? '320x240'}:rate=${options.rate ?? 25}:duration=${seconds}`,
    '-f', 'lavfi', '-i', `sine=frequency=${options.tone ?? 440}:sample_rate=44100:duration=${seconds}`,
    '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', file,
  ]);
}

const run = (args: string[], signal: AbortSignal = new AbortController().signal) => pendriveCommand.run(args, { signal });
// ultrafast keeps the tests quick; it writes a simpler H.264 (Constrained Baseline), so only the default preset is checked for High.
const FAST = ['--preset', 'ultrafast', '--paralelo', '2'];

function listParts(destination: string): string[] {
  const folder = path.join(destination, 'ASSISTA AQUI');
  return existsSync(folder) ? readdirSync(folder).sort() : [];
}

describe.skipIf(tools === null)('pendrive (real ffmpeg)', { timeout: 180_000 }, () => {
  beforeAll(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'tv-chuvisco-pendrive-'));
    library = path.join(root, 'biblioteca');
    for (let i = 1; i <= 3; i++) {
      await video(`programas/turma/episodios/00${i}.mp4`, 6, { tone: 300 + i * 50 });
      await video(`programas/pixel/episodios/00${i}.mp4`, 5, { rate: 30, size: '320x180', tone: 600 + i * 50 });
    }
    await writeFile(path.join(library, 'programas', 'turma', 'programa.yaml'), 'titulo: A Turma\n');
    await writeFile(path.join(library, 'programas', 'pixel', 'programa.yaml'), 'titulo: Pixel\n');
    // The episodes break at fixed points, so there are acts to render and join.
    await writeFile(path.join(library, 'programas', 'turma', 'episodios.yaml'), '"001":\n  intervalos: ["2"]\n"002":\n  intervalos: ["2"]\n"003":\n  intervalos: ["3"]\n');
    await video('vinhetas/aberturas/abertura.mp4', 2, { tone: 880 });
    await video('vinhetas/comerciais/a.mp4', 2, { tone: 262 });
    await video('vinhetas/comerciais/b.mp4', 3, { tone: 294 });
    await mkdir(path.join(library, 'grades'), { recursive: true });
    await writeFile(
      path.join(library, 'grades', 'teste.yaml'),
      'nome: Teste\ndata_inicio: 2026-10-05\ndias: [seg, ter, qua, qui, sex]\nblocos:\n  - horario: "08:00"\n    itens:\n      - vinheta: aberturas\n      - programa: turma\n      - programa: pixel\n',
    );
    await writeFile(path.join(library, 'configuracoes.yaml'), 'intervalos:\n  comerciais: 2\n  apos_episodio: sim\n');
  });
  afterAll(() => rm(root, { recursive: true, force: true }));
  afterEach(() => vi.restoreAllMocks());

  const quiet = () => vi.spyOn(console, 'log').mockImplementation(() => undefined);

  it('renders two airing days into numbered MP4 parts, a LEIA-ME and nothing else', async () => {
    quiet();
    const destination = path.join(root, 'saida-crt');
    const code = await run([library, '--destino', destination, '--dias', '2', '--a-partir-de', '2026-10-09', '--paralelo', '2']);
    expect(code).toBe(0);

    // 2026-10-09 is a Friday: the two airing days are Friday and Monday.
    const parts = listParts(destination);
    expect(parts).toEqual(['Dia 01 - Parte 1.mp4', 'Dia 02 - Parte 1.mp4']);
    expect(readdirSync(destination).sort()).toEqual(['ASSISTA AQUI', 'LEIA-ME.txt']); // the work folder is gone

    for (const name of parts) {
      const info = await probe(tools!, path.join(destination, 'ASSISTA AQUI', name));
      expect(info.video).toMatchObject({ codec: 'h264', profile: 'High', width: 1280, height: 720, pixFmt: 'yuv420p', colorSpace: 'bt709' });
      expect(info.video!.frameRate).toBeCloseTo(25, 1); // most of the sources are 25 fps (and so is the longest)
      expect(info.audio).toEqual([expect.objectContaining({ codec: 'aac', channels: 2, sampleRate: 48000 })]);
      // opening 2 s + 1 episode of the turma + 1 of the pixel + breaks of 2 commercials (2 s and 3 s) after each act.
      expect(info.duration!).toBeGreaterThan(20);
      expect(info.duration!).toBeLessThan(60);
    }
    const readme = readFileSync(path.join(destination, 'LEIA-ME.txt'), 'utf8');
    expect(readme).toContain('Dia 01 - Parte 1.mp4');
    expect(readme).toContain('curvatura 50%');
  });

  it('plays the same programme the dry run listed, with the length the rundown said', async () => {
    const lines: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((line?: string) => void lines.push(String(line)));
    await run([library, '--simular', '--dias', '1', '--a-partir-de', '2026-10-09']);
    const header = lines.find((line) => line.startsWith('Dia 1:'))!;
    const expected = /(?:(\d+)min)?(\d+)s/.exec(header)!;
    const seconds = Number(expected[1] ?? 0) * 60 + Number(expected[2]);

    quiet();
    const destination = path.join(root, 'saida-simular');
    await run([library, '--destino', destination, '--dias', '1', '--a-partir-de', '2026-10-09', '--sem-crt', ...FAST]);
    const info = await probe(tools!, path.join(destination, 'ASSISTA AQUI', 'Dia 01 - Parte 1.mp4'));
    expect(Math.abs(info.duration! - seconds)).toBeLessThan(1.5);
  });

  it('writes nothing with --simular', async () => {
    quiet();
    const destination = path.join(root, 'nao-criar');
    expect(await run([library, '--destino', destination, '--simular', '--dias', '2'])).toBe(0);
    expect(existsSync(destination)).toBe(false);
  });

  it('works without the CRT, stretched, without commercials, and copies the library', async () => {
    quiet();
    const destination = path.join(root, 'saida-simples');
    const code = await run([library, '--destino', destination, '--dias', '1', '--sem-crt', '--sem-comerciais', '--sem-vinhetas', '--proporcao', 'esticar', '--copiar-biblioteca', ...FAST]);
    expect(code).toBe(0);
    const info = await probe(tools!, path.join(destination, 'ASSISTA AQUI', 'Dia 01 - Parte 1.mp4'));
    expect(info.video).toMatchObject({ width: 1280, height: 720 });
    // Two episodes only, whole: 6 s (turma) + 5 s (pixel) = 11 s.
    expect(info.duration!).toBeGreaterThan(10);
    expect(info.duration!).toBeLessThan(12.5);
    expect(existsSync(path.join(destination, 'biblioteca', 'grades', 'teste.yaml'))).toBe(true);
    expect(existsSync(path.join(destination, 'biblioteca', 'programas', 'turma', 'episodios', '001.mp4'))).toBe(true);
    expect(readFileSync(path.join(destination, 'LEIA-ME.txt'), 'utf8')).toContain('TV BOX COM O APLICATIVO');
  });

  it('splits a day into several parts when the size cap is small, never inside a video', async () => {
    quiet();
    // The cap is a constant of the module; drive the renderer directly with a tiny one.
    const { renderRundown } = await import('../pendrive/render');
    const { openNodeLibrary } = await import('../node-source');
    const { scanLibrary } = await import('@tv-chuvisco/nucleo');
    const { airingDates, buildRundown, planTimelines } = await import('../pendrive/rundown');
    const { partNaming } = await import('../pendrive/names');
    const { applyFlags, encodeSettings } = await import('../pendrive/settings');

    const source = await openNodeLibrary(library);
    const lib = await scanLibrary(source);
    const settings = applyFlags(lib.settings, { 'sem-crt': true });
    const infos = new Map<string, Awaited<ReturnType<typeof probe>>>();
    const durations = {
      load: async (paths: string[]) => {
        for (const file of paths) if (!infos.has(file)) infos.set(file, await probe(tools!, source.resolve(file)));
      },
      get: (file: string) => infos.get(file)?.duration ?? undefined,
    };
    const timelines = await planTimelines(lib.schedules[0]!, lib, airingDates(lib.schedules[0]!, '2026-10-12', 1), settings, durations);
    const rundown = buildRundown(timelines, 25);
    const destination = path.join(root, 'saida-partes');
    const result = await renderRundown({
      tools: tools!,
      signal: new AbortController().signal,
      source,
      destination,
      rundown,
      encode: encodeSettings(settings, 25, 28, 'ultrafast'),
      infos,
      naming: partNaming(1, 20),
      partBytes: 2_000_000,
      concurrency: 2,
    });
    expect(result.interrupted).toBe(false);
    expect(result.parts.length).toBeGreaterThan(1);
    // Together the parts are the whole day, and no part ever ends between two commercials of one break.
    expect(result.parts.reduce((sum, part) => sum + part.seconds, 0)).toBeCloseTo(rundown.days[0]!.seconds, 1);
    expect(result.parts.map((part) => part.pieces).reduce((a, b) => a + b, 0)).toBe(rundown.days[0]!.pieces.length);
    let first = 0;
    for (const part of result.parts.slice(0, -1)) {
      first += part.pieces;
      const pieces = rundown.days[0]!.pieces;
      expect(pieces[first - 1]!.inBreak && pieces[first]!.inBreak).toBe(false);
    }
    expect(listParts(destination)).toEqual(result.parts.map((part) => part.name));
    expect(result.parts[0]!.name).toBe('Dia 01 - Parte 01.mp4');
  });

  it('stops on Ctrl+C without leaving half-written files, and resumes from what was rendered', async () => {
    quiet();
    const destination = path.join(root, 'saida-interrompida');
    const controller = new AbortController();
    const pending = run([library, '--destino', destination, '--dias', '2', '--sem-comerciais', '--paralelo', '1', '--preset', 'veryslow'], controller.signal);
    // Let the first piece or two render, then interrupt.
    const work = path.join(destination, '.tv-chuvisco-tmp');
    for (let i = 0; i < 600 && !(existsSync(work) && readdirSync(work).some((name) => name.startsWith('seg-'))); i++) await new Promise((resolve) => setTimeout(resolve, 50));
    controller.abort();
    expect(await pending).toBe(130);

    const left = readdirSync(work);
    expect(left.some((name) => name.endsWith('.parcial'))).toBe(false);
    expect(left.some((name) => name.startsWith('seg-'))).toBe(true);
    expect(listParts(destination)).toEqual([]);

    // The same command again picks up the cached pieces and finishes.
    expect(await run([library, '--destino', destination, '--dias', '2', '--sem-comerciais', ...FAST])).toBe(0);
    expect(listParts(destination)).toEqual(['Dia 01 - Parte 1.mp4', 'Dia 02 - Parte 1.mp4']);
    expect(existsSync(work)).toBe(false);
  });

  it('refuses a destination inside the library and a missing destination', async () => {
    quiet();
    await expect(run([library, '--destino', path.join(library, 'saida')])).rejects.toThrow(/dentro da biblioteca/);
    await expect(run([library])).rejects.toThrow(/--destino/);
    await expect(run([library, '--destino', path.join(root, 'x'), '--grade', 'nao-existe'])).rejects.toThrow(/Não achei a grade/);
  });
});
