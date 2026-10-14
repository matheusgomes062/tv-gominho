// Doing the work: render every piece of the rundown into a normalised intermediate MP4 in the work folder
// (`.tv-chuvisco-tmp` inside the destination), then join the pieces of each day, without re-encoding, into
// the parts the TV plays. Everything is cached by what the piece is made of, so running the same command
// again resumes where it stopped; the work folder goes away only when the job finishes.

import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { availableParallelism } from 'node:os';
import path from 'node:path';
import type { LoudnormStats } from '../convert/plan';
import { parseLoudnormStats } from '../convert/plan';
import { CliError } from '../errors';
import { lastError, probe, run, type FfmpegTools, type MediaInfo } from '../ffmpeg';
import type { NodeLibrarySource } from '../node-source';
import { ProgressLine, formatDuration } from '../ui';
import { encodePpm, maskPixels } from './crt';
import { destFolder, destPath } from './dest';
import { PLAY_FOLDER, TEMP_FOLDER, partFileName, partialName, type PartNaming } from './names';
import { PART_TARGET_BYTES, splitParts } from './parts';
import { JobProgress } from './progress';
import type { Piece, Rundown } from './rundown';
import {
  buildConcatArgs,
  buildSegmentArgs,
  concatList,
  loudnessKey,
  loudnessMeasureArgs,
  pictureBox,
  segmentFileName,
  segmentKey,
  settingsFingerprint,
  type EncodeSettings,
  type FileIdentity,
  type SegmentSource,
} from './segment';

export interface RenderOptions {
  tools: FfmpegTools;
  signal: AbortSignal;
  source: NodeLibrarySource;
  /** Absolute path of the destination (the pendrive). */
  destination: string;
  rundown: Rundown;
  encode: EncodeSettings;
  /** What ffprobe said about each library file the rundown uses. */
  infos: ReadonlyMap<string, MediaInfo>;
  naming: PartNaming;
  /** Part size target in bytes; tests use a tiny one. */
  partBytes?: number;
  /** Pieces rendered at the same time. Default: one per 4 processor cores, from 1 to 3. */
  concurrency?: number;
}

export interface RenderedPart {
  day: number;
  name: string;
  bytes: number;
  seconds: number;
  pieces: number;
  /** Taken from an earlier run (the day was already finished). */
  reused: boolean;
}

export interface RenderResult {
  parts: RenderedPart[];
  /** Pieces that could not be rendered and were left out, with the reason. */
  failures: { piece: string; message: string }[];
  /** Days with a part bigger than the target because a single video is that big. */
  oversize: string[];
  interrupted: boolean;
  /** Seconds of video rendered by this run (not counting what the cache already had). */
  renderedSeconds: number;
  elapsedMs: number;
}

interface Manifest {
  key: string;
  parts: { name: string; bytes: number; seconds: number; pieces: number }[];
}

const MAX_CONSECUTIVE_FAILURES = 3;

/** How many pieces to render at once: each ffmpeg uses a few cores for the encoder and one for the filters. */
export function defaultConcurrency(cores = availableParallelism()): number {
  return Math.min(3, Math.max(1, Math.floor(cores / 4)));
}
const DURATION_TOLERANCE = 1.0;

/** Prepares the work folder: creates it with a marker file and drops the half-written files of an earlier run. */
export async function prepareTemp(destination: string): Promise<string> {
  const temp = await destFolder(destination, TEMP_FOLDER);
  await writeFile(path.join(temp, '.tv-chuvisco'), 'Pasta de trabalho do TV Chuvisco. Pode apagar quando o comando terminar.\n');
  for (const entry of await readdir(temp).catch(() => [])) {
    if (entry.endsWith('.parcial') || entry.startsWith('list-')) await rm(path.join(temp, entry), { force: true });
  }
  return temp;
}

/** Deletes the work folder, but only if it is the one this tool made. */
export async function removeTemp(destination: string): Promise<void> {
  const temp = await destPath(destination, TEMP_FOLDER);
  if (existsSync(path.join(temp, '.tv-chuvisco'))) await rm(temp, { recursive: true, force: true });
}

async function identityOf(source: NodeLibrarySource, file: string): Promise<FileIdentity> {
  const absolute = source.resolve(file);
  const info = await stat(absolute);
  return { path: absolute, size: info.size, mtimeMs: info.mtimeMs };
}

/** The renderer's view of a piece's source file. */
function sourceOf(piece: Piece, info: MediaInfo, file: string, loudness: LoudnormStats | null): SegmentSource {
  return {
    file,
    startFrame: piece.startFrame,
    frames: piece.frames,
    hasAudio: info.audio.length > 0,
    height: info.video?.height ?? 0,
    colorSpace: info.video?.colorSpace ?? null,
    sampleAspectRatio: info.video?.sampleAspectRatio ?? 1,
    loudness,
  };
}

const dayKeyOf = (keys: readonly string[], cap: number) => createHash('sha1').update(JSON.stringify([keys, cap])).digest('hex').slice(0, 20);

async function readJson<T>(file: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(file, 'utf8')) as T;
  } catch {
    return null;
  }
}

export async function renderRundown(options: RenderOptions): Promise<RenderResult> {
  const { tools, signal, source, destination, rundown, encode, infos, naming } = options;
  const cap = options.partBytes ?? PART_TARGET_BYTES;
  const concurrency = Math.max(1, options.concurrency ?? defaultConcurrency());
  const started = Date.now();
  const result: RenderResult = { parts: [], failures: [], oversize: [], interrupted: false, renderedSeconds: 0, elapsedMs: 0 };
  const temp = await prepareTemp(destination);
  const playFolder = await destFolder(destination, PLAY_FOLDER);

  // ---- what is already done
  const identities = new Map<string, FileIdentity>();
  for (const day of rundown.days) {
    for (const piece of day.pieces) {
      if (!identities.has(piece.path)) identities.set(piece.path, await identityOf(source, piece.path));
    }
  }
  const keyOf = (piece: Piece) => segmentKey(identities.get(piece.path)!, piece.startFrame, piece.frames, encode);
  const dayKeys = rundown.days.map((day) => day.pieces.map(keyOf));

  const reusable = new Map<number, Manifest>();
  for (const [index, day] of rundown.days.entries()) {
    const manifest = await readJson<Manifest>(path.join(temp, `dia-${day.number}.json`));
    const key = dayKeyOf(dayKeys[index]!, cap);
    if (manifest?.key !== key) continue;
    const present = await Promise.all(
      manifest.parts.map(async (part) => (await stat(path.join(playFolder, part.name)).catch(() => null))?.size === part.bytes),
    );
    if (present.every(Boolean)) reusable.set(day.number, manifest);
  }

  /** Keys of the pieces still to render, with the first piece that needs each. */
  const pending = new Map<string, Piece>();
  for (const [index, day] of rundown.days.entries()) {
    if (reusable.has(day.number)) continue;
    for (const [i, piece] of day.pieces.entries()) {
      const key = dayKeys[index]![i]!;
      if (!pending.has(key) && !existsSync(path.join(temp, segmentFileName(key)))) pending.set(key, piece);
    }
  }
  const totalSeconds = [...pending.values()].reduce((sum, piece) => sum + piece.seconds, 0);
  const progress = new JobProgress(totalSeconds, pending.size);
  const say = (line: string) => {
    progress.clear();
    console.log(line);
  };

  // ---- the mask of the CRT look, made once
  let maskFile: string | null = null;
  if (encode.crt && pending.size > 0) {
    const box = pictureBox(encode.aspect);
    const hash = createHash('sha1').update(settingsFingerprint(encode)).update(`${box.width}x${box.height}`).digest('hex').slice(0, 12);
    maskFile = path.join(temp, `mask-${hash}.ppm`);
    if (!existsSync(maskFile)) {
      const partial = path.join(temp, partialName(path.basename(maskFile)));
      await writeFile(partial, encodePpm(box.width, box.height, maskPixels(encode.crt, box.width, box.height)));
      await rename(partial, maskFile);
    }
  }

  // ---- volume of the files that have to be rendered
  const loudness = await measureLoudness({ tools, signal, source, temp, pieces: [...pending.values()], infos, identities, say });
  if (loudness === 'interrupted') return { ...result, interrupted: true, elapsedMs: Date.now() - started };

  // ---- day by day
  let itemNumber = 0;
  let consecutiveFailures = 0;

  for (const [index, day] of rundown.days.entries()) {
    const reused = reusable.get(day.number);
    if (reused) {
      say(`Dia ${day.number}: já estava pronto de uma execução anterior.`);
      for (const part of reused.parts) result.parts.push({ day: day.number, ...part, reused: true });
      continue;
    }

    say(`Dia ${day.number}: ${day.pieces.length} itens, ${formatDuration(day.seconds)}`);
    const keys = dayKeys[index]!;

    // The pieces of this day still to render (each key once), a few at a time: the filters run on one core
    // each, so several pieces at once keep the whole machine busy.
    const todo: { piece: Piece; key: string }[] = [];
    for (const [i, piece] of day.pieces.entries()) {
      const key = keys[i]!;
      if (pending.has(key) && !todo.some((job) => job.key === key)) todo.push({ piece, key });
    }
    const stop = new AbortController();
    const onAbort = () => stop.abort();
    signal.addEventListener('abort', onAbort, { once: true });
    let next = 0;
    const worker = async () => {
      for (;;) {
        const job = stop.signal.aborted ? undefined : todo[next++];
        if (!job) return;
        const { piece, key } = job;
        const id = ++itemNumber;
        const info = infos.get(piece.path)!;
        const identity = identities.get(piece.path)!;
        progress.begin(id, `Dia ${day.number}: ${describe(piece)}`, piece.seconds);
        const partial = path.join(temp, partialName(segmentFileName(key)));
        await rm(partial, { force: true });
        const outcome = await run(
          tools,
          buildSegmentArgs(sourceOf(piece, info, identity.path, loudness.get(identity.path) ?? null), encode, partial, maskFile),
          { duration: piece.seconds, signal: stop.signal, onProgress: (p) => progress.update(id, p) },
        );
        progress.end(id);
        pending.delete(key);
        if (outcome.aborted) {
          await rm(partial, { force: true });
          return;
        }
        if (!outcome.ok) {
          await rm(partial, { force: true });
          const message = lastError(outcome.stderr);
          result.failures.push({ piece: piece.path, message });
          say(`  Não consegui renderizar "${piece.path}": ${message}. O item foi pulado.`);
          if (++consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
            stop.abort();
            throw new CliError(`O ffmpeg falhou ${MAX_CONSECUTIVE_FAILURES} vezes seguidas; parei. Último erro: ${message}`);
          }
          continue;
        }
        consecutiveFailures = 0;
        await rename(partial, path.join(temp, segmentFileName(key)));
        result.renderedSeconds += piece.seconds;
      }
    };
    const workers = await Promise.allSettled(Array.from({ length: Math.min(concurrency, todo.length) }, worker));
    signal.removeEventListener('abort', onAbort);
    progress.clear();
    const crashed = workers.find((outcome) => outcome.status === 'rejected');
    if (crashed) throw (crashed as PromiseRejectedResult).reason;
    if (signal.aborted) return finish(true);

    const usable: { piece: Piece; key: string }[] = [];
    for (const [i, piece] of day.pieces.entries()) {
      if (existsSync(path.join(temp, segmentFileName(keys[i]!)))) usable.push({ piece, key: keys[i]! });
    }

    if (usable.length === 0) {
      say(`Dia ${day.number}: nenhum item pôde ser renderizado; o dia ficou de fora.`);
      continue;
    }

    // ---- parts: split by the real sizes of the pieces, then joined
    const sizes = await Promise.all(usable.map(async ({ key }) => (await stat(path.join(temp, segmentFileName(key)))).size));
    const ranges = splitParts(
      usable.map(({ piece }) => piece),
      sizes,
      cap,
    );
    const manifest: Manifest = { key: dayKeyOf(keys, cap), parts: [] };
    for (const [p, range] of ranges.entries()) {
      if (signal.aborted) return finish(true);
      const members = usable.slice(range.start, range.end);
      const name = partFileName(day.number, p + 1, naming);
      const seconds = members.reduce((sum, { piece }) => sum + piece.seconds, 0);
      if (range.oversize) result.oversize.push(name);

      const list = path.join(temp, `list-${day.number}-${p + 1}.txt`);
      await writeFile(list, concatList(members.map(({ key }) => segmentFileName(key))));
      const partial = path.join(temp, partialName(name));
      const bar = new ProgressLine(`  Juntando ${name}: `);
      const joined = await run(tools, buildConcatArgs(list, partial), { duration: seconds, signal, onProgress: (x) => bar.update(x) });
      bar.finish();
      await rm(list, { force: true });
      if (joined.aborted) {
        await rm(partial, { force: true });
        return finish(true);
      }
      if (!joined.ok) {
        await rm(partial, { force: true });
        throw new CliError(`Não consegui juntar ${name}: ${lastError(joined.stderr)}`);
      }
      const check = await probe(tools, partial).catch((error: Error) => {
        throw new CliError(`${name} não pôde ser lido depois de gerado: ${error.message}`);
      });
      if (!check.video || check.video.codec !== 'h264' || check.audio.length === 0) {
        await rm(partial, { force: true });
        throw new CliError(`${name} saiu sem vídeo H.264 ou sem áudio; nada foi gravado.`);
      }
      if (check.duration !== null && Math.abs(check.duration - seconds) > Math.max(DURATION_TOLERANCE, seconds * 0.01)) {
        await rm(partial, { force: true });
        throw new CliError(`${name} saiu com ${formatDuration(check.duration)}, mas deveria ter ${formatDuration(seconds)}; nada foi gravado.`);
      }

      const final = await destPath(destination, PLAY_FOLDER, name);
      await rm(final, { force: true });
      await rename(partial, final);
      const bytes = (await stat(final)).size;
      manifest.parts.push({ name, bytes, seconds, pieces: members.length });
      result.parts.push({ day: day.number, name, bytes, seconds, pieces: members.length, reused: false });
      say(`  ${name}: ${members.length} itens, ${formatDuration(seconds)}`);
    }
    await writeFile(path.join(temp, `dia-${day.number}.json`), JSON.stringify(manifest));

    // Pieces no later day needs are not worth the disk space any more.
    const later = new Set<string>();
    for (let j = index + 1; j < rundown.days.length; j++) {
      if (!reusable.has(rundown.days[j]!.number)) for (const key of dayKeys[j]!) later.add(key);
    }
    for (const { key } of usable) {
      if (!later.has(key)) await rm(path.join(temp, segmentFileName(key)), { force: true });
    }
  }

  return finish(false);

  function finish(interrupted: boolean): RenderResult {
    progress.clear();
    return { ...result, interrupted, elapsedMs: Date.now() - started };
  }
}

/** "Show: Episódio (trecho 2/3)", "Comercial: nome". */
export function describe(piece: Piece, withKind = true): string {
  const act = piece.act && piece.act.count > 1 ? ` (trecho ${piece.act.index}/${piece.act.count})` : '';
  const kind = withKind && piece.role === 'comercial' ? 'comercial' : withKind && piece.role === 'vinheta' ? 'vinheta' : '';
  return `${kind ? `${kind}: ` : ''}${piece.title}${act}`;
}

// ---------------------------------------------------------------- loudness

interface MeasureOptions {
  tools: FfmpegTools;
  signal: AbortSignal;
  source: NodeLibrarySource;
  temp: string;
  pieces: Piece[];
  infos: ReadonlyMap<string, MediaInfo>;
  identities: ReadonlyMap<string, FileIdentity>;
  say: (line: string) => void;
}

/**
 * Measures the loudness of each file that has sound and is about to be rendered (EBU R128 through `loudnorm`),
 * so that every piece of a file gets the same gain, even the acts of an episode rendered separately.
 * Results are cached in the work folder. Keyed by the absolute path of the file; null means a silent file.
 */
async function measureLoudness(options: MeasureOptions): Promise<Map<string, LoudnormStats | null> | 'interrupted'> {
  const { tools, signal, temp, pieces, infos, identities, say } = options;
  const cacheFile = path.join(temp, 'volume.json');
  const cache = (await readJson<Record<string, LoudnormStats | null>>(cacheFile)) ?? {};
  const result = new Map<string, LoudnormStats | null>();

  const files = [...new Set(pieces.map((piece) => piece.path))].filter((file) => (infos.get(file)?.audio.length ?? 0) > 0);
  const todo: string[] = [];
  for (const file of files) {
    const identity = identities.get(file)!;
    const key = loudnessKey(identity);
    if (key in cache) result.set(identity.path, cache[key]!);
    else todo.push(file);
  }
  if (todo.length === 0) return result;

  say(`Medindo o volume de ${todo.length} ${todo.length === 1 ? 'arquivo' : 'arquivos'} (para igualar episódios, vinhetas e comerciais)...`);
  for (const [i, file] of todo.entries()) {
    if (signal.aborted) return 'interrupted';
    const identity = identities.get(file)!;
    const bar = new ProgressLine(`  ${i + 1}/${todo.length} `);
    const measured = await run(tools, loudnessMeasureArgs(identity.path), {
      duration: infos.get(file)?.duration ?? null,
      logLevel: 'info',
      signal,
      onProgress: (p) => bar.update(p),
    });
    bar.finish();
    if (measured.aborted) return 'interrupted';
    if (!measured.ok) throw new CliError(`Falha ao medir o volume de "${file}": ${lastError(measured.stderr)}`);
    // A silent (or unmeasurable) file stays as it is: loudnorm cannot be tuned for it.
    const stats = parseLoudnormStats(measured.stderr);
    cache[loudnessKey(identity)] = stats;
    result.set(identity.path, stats);
    await writeFile(cacheFile, JSON.stringify(cache));
  }
  return result;
}
