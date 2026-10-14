// Progress of the whole pendrive job: one overall percentage (seconds of video rendered over seconds to
// render) plus the items being rendered. On a terminal it is a single line redrawn in place; when the output
// goes to a file it prints one line per finished item instead.

import type { Progress } from '../ffmpeg/run';
import { formatDuration } from '../ui';

const interactive = Boolean(process.stdout.isTTY);

interface Running {
  label: string;
  seconds: number;
  position: number;
  speed: number | null;
}

export class JobProgress {
  private done = 0;
  private finishedItems = 0;
  private readonly running = new Map<number, Running>();
  private readonly started = Date.now();
  private drawn = false;
  private lastPercentPrinted = -1;

  constructor(
    /** Seconds of video the job has to render (what is already rendered doesn't count). */
    private readonly total: number,
    /** How many items that is. */
    private readonly count: number,
  ) {}

  /** 0-100, rounded down. */
  get percent(): number {
    if (this.total <= 0) return 100;
    let finished = this.done;
    for (const item of this.running.values()) finished += item.position;
    return Math.min(100, Math.floor((finished / this.total) * 100));
  }

  /** Starts an item that has `seconds` of video; `label` is what to show. Items may run at the same time. */
  begin(id: number, label: string, seconds: number): void {
    this.running.set(id, { label, seconds, position: 0, speed: null });
    this.draw();
  }

  update(id: number, progress: Progress): void {
    const item = this.running.get(id);
    if (!item) return;
    item.position = Math.min(item.seconds, progress.seconds);
    item.speed = progress.speed;
    this.draw();
  }

  /** The item is finished (or failed: its video no longer counts as pending). */
  end(id: number): void {
    const item = this.running.get(id);
    if (!item) return;
    this.running.delete(id);
    this.done += item.seconds;
    this.finishedItems++;
    if (!interactive) {
      const percent = this.percent;
      if (percent !== this.lastPercentPrinted) {
        this.lastPercentPrinted = percent;
        console.log(`  [${String(percent).padStart(3)}%] ${item.label} (${formatDuration(item.seconds)})`);
      }
    }
    this.draw();
  }

  /** Clears the redrawn line so a message can be printed. */
  clear(): void {
    if (interactive && this.drawn) process.stdout.write('\r\x1b[K');
    this.drawn = false;
  }

  private eta(): string {
    const elapsed = (Date.now() - this.started) / 1000;
    let finished = this.done;
    for (const item of this.running.values()) finished += item.position;
    if (elapsed < 15 || finished <= 0 || this.total <= finished) return '';
    return ` · falta ~${formatDuration((elapsed / finished) * (this.total - finished))}`;
  }

  private draw(): void {
    if (!interactive || this.running.size === 0) return;
    const first = this.running.values().next().value as Running;
    const itemPercent = first.seconds > 0 ? Math.floor((first.position / first.seconds) * 100) : 100;
    const together = this.running.size > 1 ? ` (+${this.running.size - 1})` : '';
    const text = `[${String(this.percent).padStart(3)}%] ${this.finishedItems + 1}/${this.count}${this.eta()}  ${first.label} ${itemPercent}%${together}`;
    const width = process.stdout.columns ?? 100;
    process.stdout.write(`\r  ${text.length > width - 3 ? `${text.slice(0, width - 4)}…` : text}\x1b[K`);
    this.drawn = true;
  }
}
