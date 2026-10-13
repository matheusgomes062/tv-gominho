import type { BrowserLibrary } from './sources/types';

const CACHE_PREFIX = 'tv-chuvisco.duracao.';
const PROBE_TIMEOUT_MS = 15_000;
const PARALLEL_PROBES = 4;

/** Video durations, read from the files' metadata and cached between visits. */
export class Durations {
  private known = new Map<string, number | null>();

  constructor(private library: BrowserLibrary) {}

  /** Synchronous lookup for buildTimeline; undefined if not loaded or unreadable. */
  get = (path: string): number | undefined => this.known.get(path) ?? undefined;

  /** Loads the durations of `paths`, reporting progress as (done, total). */
  async load(paths: string[], onProgress?: (done: number, total: number) => void): Promise<void> {
    const pending = paths.filter((path) => !this.known.has(path));
    let done = paths.length - pending.length;
    onProgress?.(done, paths.length);

    const next = async (): Promise<void> => {
      const path = pending.shift();
      if (path === undefined) return;
      this.known.set(path, await this.read(path));
      onProgress?.(++done, paths.length);
      return next();
    };
    await Promise.all(Array.from({ length: PARALLEL_PROBES }, next));
  }

  private async read(path: string): Promise<number | null> {
    const fingerprint = await this.library.fingerprint(path).catch(() => undefined);
    const cacheKey = fingerprint && `${CACHE_PREFIX}${path}|${fingerprint}`;
    if (cacheKey) {
      const cached = Number(safeStorage(() => localStorage.getItem(cacheKey)));
      if (cached > 0) return cached;
    }
    const duration = await probe(await this.library.url(path));
    if (cacheKey && duration) safeStorage(() => localStorage.setItem(cacheKey, String(duration)));
    return duration;
  }
}

function probe(url: string): Promise<number | null> {
  return new Promise((resolve) => {
    const video = document.createElement('video');
    const finish = (duration: number | null) => {
      clearTimeout(timer);
      video.removeAttribute('src');
      video.load();
      resolve(duration);
    };
    const timer = setTimeout(() => finish(null), PROBE_TIMEOUT_MS);
    video.preload = 'metadata';
    video.muted = true;
    video.onloadedmetadata = () => finish(Number.isFinite(video.duration) && video.duration > 0 ? video.duration : null);
    video.onerror = () => finish(null);
    video.src = url;
  });
}

function safeStorage<T>(action: () => T): T | null {
  try {
    return action();
  } catch {
    return null;
  }
}
