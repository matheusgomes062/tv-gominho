import { spawn } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { CliError } from '../errors';

export interface FfmpegTools {
  ffmpeg: string;
  ffprobe: string;
  /** First line of `ffmpeg -version`, e.g. "ffmpeg version 7.1". */
  version: string;
}

export interface LocateOptions {
  /** Value of the --ffmpeg flag: the executable or the folder that holds it. */
  ffmpeg?: string;
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
}

export const INSTALL_HINT = [
  'Instale o ffmpeg e tente de novo:',
  '  Windows:               winget install Gyan.FFmpeg   (depois abra um novo terminal)',
  '  Debian/Ubuntu/Pi OS:   sudo apt install ffmpeg',
  '  macOS:                 brew install ffmpeg',
  'Se ele já está instalado fora do PATH, use --ffmpeg <caminho> ou a variável de ambiente FFMPEG.',
].join('\n');

export class FfmpegMissingError extends CliError {
  constructor(what = 'ffmpeg', detail?: string) {
    super(`${what} não encontrado${detail ? ` (${detail})` : ''}.\n${INSTALL_HINT}`);
    this.name = 'FfmpegMissingError';
  }
}

const exe = (name: string, platform: NodeJS.Platform) => (platform === 'win32' ? `${name}.exe` : name);

/** The ffprobe that lives next to a given ffmpeg executable (they ship together). */
export function siblingProbe(ffmpegPath: string, platform: NodeJS.Platform = process.platform): string {
  const dir = path.dirname(ffmpegPath);
  const name = path.basename(ffmpegPath).replace(/ffmpeg/i, 'ffprobe');
  return path.join(dir, name === path.basename(ffmpegPath) ? exe('ffprobe', platform) : name);
}

/** A --ffmpeg / FFMPEG value may point to the executable or to its folder. */
export function resolveExecutable(value: string, name: 'ffmpeg' | 'ffprobe', platform: NodeJS.Platform = process.platform): string {
  try {
    if (statSync(value).isDirectory()) return path.join(value, exe(name, platform));
  } catch {
    // Not a path on disk: maybe a command name found through the PATH.
  }
  return value;
}

/**
 * Absolute path of `name` found in the PATH's absolute folders, or null. Done by hand
 * because spawning a bare name on Windows searches the current folder first, so an
 * ffmpeg.exe planted in a library (e.g. on a shared USB stick) would run instead.
 */
export function findOnPath(name: string, env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): string | null {
  const pathValue = env.PATH ?? env.Path ?? '';
  const delimiter = platform === 'win32' ? ';' : ':';
  for (const folder of pathValue.split(delimiter)) {
    if (!folder || !path.isAbsolute(folder)) continue;
    const file = path.join(folder, exe(name, platform));
    try {
      if (statSync(file).isFile()) return file;
    } catch {
      // Not in this folder.
    }
  }
  return null;
}

/** An explicit value that isn't a path (e.g. "ffmpeg") is looked up in the PATH, never the current folder. */
function absoluteCommand(value: string, name: 'ffmpeg' | 'ffprobe', env: NodeJS.ProcessEnv, platform: NodeJS.Platform): string {
  const resolved = resolveExecutable(value, name, platform);
  if (path.isAbsolute(resolved)) return resolved;
  if (/[\\/]/.test(resolved)) return path.resolve(resolved);
  return findOnPath(resolved.replace(/\.exe$/i, ''), env, platform) ?? resolved;
}

/** Candidates in priority order: flag, FFMPEG variable, PATH, then well-known install folders. All absolute when found. */
export function ffmpegCandidates(options: LocateOptions = {}): string[] {
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  const candidates: string[] = [];
  if (options.ffmpeg) candidates.push(absoluteCommand(options.ffmpeg, 'ffmpeg', env, platform));
  if (env.FFMPEG) candidates.push(absoluteCommand(env.FFMPEG, 'ffmpeg', env, platform));
  const onPath = findOnPath('ffmpeg', env, platform);
  if (onPath) candidates.push(onPath);
  if (platform === 'win32') candidates.push(...wingetInstalls(env));
  return candidates;
}

/** `winget install Gyan.FFmpeg` only reaches the PATH of terminals opened afterwards. */
function wingetInstalls(env: NodeJS.ProcessEnv): string[] {
  const packages = env.LOCALAPPDATA && path.join(env.LOCALAPPDATA, 'Microsoft', 'WinGet', 'Packages');
  if (!packages || !existsSync(packages)) return [];
  const found: string[] = [];
  try {
    for (const entry of readdirSync(packages)) {
      if (!entry.startsWith('Gyan.FFmpeg')) continue;
      for (const build of readdirSync(path.join(packages, entry))) {
        const file = path.join(packages, entry, build, 'bin', 'ffmpeg.exe');
        if (existsSync(file)) found.push(file);
      }
    }
  } catch {
    // Unreadable folder: ignore.
  }
  return found;
}

/** Runs `<binary> -version`; resolves to its first output line, or null when it can't run. */
export function checkBinary(binary: string): Promise<string | null> {
  return new Promise((resolve) => {
    let output = '';
    const child = spawn(binary, ['-version'], { stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true });
    child.stdout.on('data', (chunk: Buffer) => (output += chunk.toString()));
    child.on('error', () => resolve(null));
    child.on('close', (code) => resolve(code === 0 ? (output.split(/\r?\n/)[0] ?? '') : null));
  });
}

/** Finds a working ffmpeg and ffprobe pair, or throws a pt-BR error with install hints. */
export async function locateFfmpeg(options: LocateOptions = {}): Promise<FfmpegTools> {
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;
  // An explicit choice (flag or variable) that doesn't work is an error, not a reason to silently use another ffmpeg.
  const explicitCount = (options.ffmpeg ? 1 : 0) + (env.FFMPEG ? 1 : 0);

  for (const [index, candidate] of ffmpegCandidates(options).entries()) {
    const version = await checkBinary(candidate);
    if (version === null) {
      if (index < explicitCount) throw new FfmpegMissingError('ffmpeg', `não foi possível executar "${candidate}"`);
      continue;
    }
    const probeCandidates = [
      env.FFPROBE && absoluteCommand(env.FFPROBE, 'ffprobe', env, platform),
      siblingProbe(candidate, platform),
      findOnPath('ffprobe', env, platform),
    ].filter((item): item is string => Boolean(item) && path.isAbsolute(item as string));
    for (const ffprobe of probeCandidates) {
      if ((await checkBinary(ffprobe)) !== null) return { ffmpeg: candidate, ffprobe, version };
    }
    throw new FfmpegMissingError('ffprobe', 'o ffmpeg foi encontrado, mas o ffprobe que vem junto não');
  }
  throw new FfmpegMissingError();
}
