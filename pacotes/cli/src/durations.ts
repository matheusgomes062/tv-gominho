import { probe, type FfmpegTools, type MediaInfo } from './ffmpeg';
import type { NodeLibrarySource } from './node-source';
import type { DurationSource } from './pendrive/rundown';

const PROBE_CONCURRENCY = 4;

/** ffprobe of the library's files, once each, a few at a time. */
export class Durations implements DurationSource {
  readonly infos = new Map<string, MediaInfo>();
  private readonly failed = new Set<string>();

  constructor(
    private readonly tools: FfmpegTools,
    private readonly source: NodeLibrarySource,
    private readonly signal: AbortSignal,
    private readonly warn: (message: string) => void,
  ) {}

  async load(paths: string[]): Promise<void> {
    const todo = paths.filter((file) => !this.infos.has(file) && !this.failed.has(file));
    let next = 0;
    const worker = async () => {
      while (!this.signal.aborted) {
        const file = todo[next++];
        if (file === undefined) return;
        try {
          const info = await probe(this.tools, this.source.resolve(file));
          if (info.video && info.duration) this.infos.set(file, info);
          else throw new Error(info.video ? 'o arquivo não informa a duração' : 'o arquivo não tem vídeo');
        } catch (error) {
          this.failed.add(file);
          this.warn(`Não consegui ler "${file}": ${(error as Error).message}. O item será pulado.`);
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(PROBE_CONCURRENCY, todo.length) }, worker));
  }

  get = (file: string) => this.infos.get(file)?.duration ?? undefined;
}
