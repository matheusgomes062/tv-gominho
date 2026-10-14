import type { Progress } from './ffmpeg/run';

// Console helpers shared by the commands. Output is pt-BR.

export function formatBytes(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unit = 0;
  while (Math.abs(value) >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  const text = unit === 0 ? String(Math.round(value)) : value.toFixed(value >= 100 ? 0 : 1).replace('.', ',');
  return `${text} ${units[unit]}`;
}

/** 3725 -> "1h02min"; 185 -> "3min05s"; 12 -> "12s". */
export function formatDuration(totalSeconds: number): string {
  const seconds = Math.max(0, Math.round(totalSeconds));
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}h${String(m).padStart(2, '0')}min`;
  if (m > 0) return `${m}min${String(s).padStart(2, '0')}s`;
  return `${s}s`;
}

export const plural = (count: number, singular: string, pluralForm = `${singular}s`) =>
  `${count} ${count === 1 ? singular : pluralForm}`;

const interactive = Boolean(process.stdout.isTTY);

/**
 * One progress report per file. On a terminal it redraws a single line; when the
 * output is piped to a file it prints a line every 25% instead of flooding the log.
 */
export class ProgressLine {
  private lastQuarter = -1;
  private drawn = false;

  constructor(private readonly label = '') {}

  update(progress: Progress): void {
    const text = this.format(progress);
    if (interactive) {
      process.stdout.write(`\r  ${text}\x1b[K`);
      this.drawn = true;
      return;
    }
    const quarter = progress.percent === null ? -1 : Math.floor(progress.percent / 25);
    if (quarter > this.lastQuarter) {
      this.lastQuarter = quarter;
      console.log(`  ${text}`);
    }
  }

  /** Clears the redrawn line so the next message starts clean. */
  finish(): void {
    if (interactive && this.drawn) process.stdout.write('\r\x1b[K');
    this.drawn = false;
  }

  private format(progress: Progress): string {
    const speed = progress.speed ? ` ${progress.speed.toFixed(1).replace('.', ',')}x` : '';
    if (progress.percent === null) return `${this.label}${formatDuration(progress.seconds)} processados${speed}`;
    const width = 24;
    const filled = Math.round((progress.percent / 100) * width);
    const bar = `${'#'.repeat(filled)}${'-'.repeat(width - filled)}`;
    return `${this.label}[${bar}] ${String(Math.floor(progress.percent)).padStart(3)}%${speed}`;
  }
}
