import { spawn } from 'node:child_process';
import type { FfmpegTools } from './locate';
import { FfmpegMissingError } from './locate';

export interface Progress {
  /** Seconds of output produced so far. */
  seconds: number;
  /** 0-100, or null when the total duration is unknown. */
  percent: number | null;
  /** Encoding speed relative to real time (2 = twice as fast as playing), when ffmpeg reports it. */
  speed: number | null;
}

/**
 * Parses the `key=value` lines that `ffmpeg -progress pipe:1` prints. A report is
 * a block of lines ending in `progress=continue` or `progress=end`. Feed it raw
 * chunks: lines split across chunks are handled.
 */
export class ProgressParser {
  private buffer = '';
  private block: Record<string, string> = {};

  constructor(private readonly duration: number | null) {}

  feed(chunk: string): Progress[] {
    this.buffer += chunk;
    const lines = this.buffer.split(/\r?\n/);
    this.buffer = lines.pop() ?? '';
    const reports: Progress[] = [];
    for (const line of lines) {
      const eq = line.indexOf('=');
      if (eq < 0) continue;
      const key = line.slice(0, eq).trim();
      const value = line.slice(eq + 1).trim();
      this.block[key] = value;
      if (key === 'progress') {
        const report = this.report(value === 'end');
        if (report) reports.push(report);
        this.block = {};
      }
    }
    return reports;
  }

  private report(finished: boolean): Progress | null {
    const seconds = outTimeSeconds(this.block);
    if (seconds === null && !finished) return null;
    const done = finished && this.duration !== null ? this.duration : (seconds ?? 0);
    const speed = /^([\d.]+)x$/.exec(this.block.speed ?? '');
    return {
      seconds: done,
      percent: this.duration ? Math.max(0, Math.min(100, (done / this.duration) * 100)) : null,
      speed: speed ? Number(speed[1]) : null,
    };
  }
}

/** `out_time_us` and `out_time_ms` are both microseconds (ffmpeg's naming is misleading); `out_time` is HH:MM:SS.xx. */
function outTimeSeconds(block: Record<string, string>): number | null {
  for (const key of ['out_time_us', 'out_time_ms']) {
    const value = Number(block[key]);
    if (block[key] !== undefined && Number.isFinite(value) && value >= 0) return value / 1_000_000;
  }
  const match = /^(\d+):(\d+):(\d+(?:\.\d+)?)$/.exec(block.out_time ?? '');
  return match ? Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]) : null;
}

export interface RunOptions {
  /** Duration of the expected output in seconds; enables `percent`. */
  duration?: number | null;
  onProgress?: (progress: Progress) => void;
  /** Aborting kills ffmpeg. The caller is responsible for deleting the partial output. */
  signal?: AbortSignal;
  /** ffmpeg -loglevel; "error" by default. Use "info" to read filter statistics (loudnorm). */
  logLevel?: string;
}

export interface RunResult {
  ok: boolean;
  aborted: boolean;
  exitCode: number | null;
  /** What ffmpeg wrote to stderr (only its tail when it is very long). */
  stderr: string;
}

const STDERR_LIMIT = 64 * 1024;

/** Runs ffmpeg with the given arguments (without the global flags, which are added here). */
export function run(tools: FfmpegTools, args: string[], options: RunOptions = {}): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const { signal } = options;
    if (signal?.aborted) {
      resolve({ ok: false, aborted: true, exitCode: null, stderr: '' });
      return;
    }

    const globalFlags = ['-hide_banner', '-nostdin', '-nostats', '-loglevel', options.logLevel ?? 'error', '-progress', 'pipe:1'];
    const child = spawn(tools.ffmpeg, [...globalFlags, ...args], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });

    const parser = new ProgressParser(options.duration ?? null);
    child.stdout.on('data', (chunk: Buffer) => {
      for (const report of parser.feed(chunk.toString())) options.onProgress?.(report);
    });

    let stderr = '';
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
      if (stderr.length > STDERR_LIMIT * 2) stderr = stderr.slice(-STDERR_LIMIT);
    });

    let aborted = false;
    const onAbort = () => {
      aborted = true;
      child.kill();
    };
    signal?.addEventListener('abort', onAbort, { once: true });

    child.on('error', (error: NodeJS.ErrnoException) => {
      signal?.removeEventListener('abort', onAbort);
      reject(error.code === 'ENOENT' ? new FfmpegMissingError() : error);
    });
    child.on('close', (code) => {
      signal?.removeEventListener('abort', onAbort);
      resolve({ ok: code === 0 && !aborted, aborted, exitCode: code, stderr: stderr.slice(-STDERR_LIMIT) });
    });
  });
}

/** Last meaningful line of ffmpeg's stderr, for error messages. */
export function lastError(stderr: string): string {
  const lines = stderr.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  return lines[lines.length - 1] ?? 'o ffmpeg terminou com erro.';
}
