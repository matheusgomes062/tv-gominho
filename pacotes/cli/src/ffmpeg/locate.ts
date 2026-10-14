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

/** Candidates in priority order: flag, FFMPEG variable, PATH, then well-known install folders. */
export function ffmpegCandidates(options: LocateOptions = {}): string[] {
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  const candidates: string[] = [];
  if (options.ffmpeg) candidates.push(resolveExecutable(options.ffmpeg, 'ffmpeg', platform));
  if (env.FFMPEG) candidates.push(resolveExecutable(env.FFMPEG, 'ffmpeg', platform));
  candidates.push('ffmpeg');
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
      env.FFPROBE && resolveExecutable(env.FFPROBE, 'ffprobe', platform),
      // A bare "ffmpeg" means PATH, so ffprobe should come from the PATH too.
      candidate === 'ffmpeg' ? 'ffprobe' : siblingProbe(candidate, platform),
      'ffprobe',
    ].filter((item): item is string => Boolean(item));
    for (const ffprobe of probeCandidates) {
      if ((await checkBinary(ffprobe)) !== null) return { ffmpeg: candidate, ffprobe, version };
    }
    throw new FfmpegMissingError('ffprobe', 'o ffmpeg foi encontrado, mas o ffprobe que vem junto não');
  }
  throw new FfmpegMissingError();
}
