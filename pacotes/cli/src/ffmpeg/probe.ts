import { spawn } from 'node:child_process';
import type { FfmpegTools } from './locate';

export interface VideoStream {
  /** Index among all streams of the file. */
  index: number;
  codec: string;
  /** "High", "Main", "High 10"... as reported by ffprobe. */
  profile: string | null;
  pixFmt: string | null;
  width: number;
  height: number;
  /** Frames per second (average), or null when ffprobe doesn't say. */
  frameRate: number | null;
  /** Pixel shape (width / height of one pixel); 1 when unknown. */
  sampleAspectRatio: number;
  /** ffprobe's `color_space` ("bt709", "bt470bg", "smpte170m"...), or null when the file doesn't say. */
  colorSpace: string | null;
}

export interface AudioStream {
  index: number;
  codec: string;
  channels: number;
  sampleRate: number | null;
  language: string | null;
}

export interface MediaInfo {
  /** Seconds, or null when the container doesn't say (some MKV/TS files). */
  duration: number | null;
  /** ffprobe's container name, e.g. "matroska,webm" or "mov,mp4,m4a,3gp,3g2,mj2". */
  container: string;
  size: number | null;
  /** First real video stream (cover art is ignored); null for audio-only files. */
  video: VideoStream | null;
  audio: AudioStream[];
}

interface RawStream {
  index?: number;
  codec_type?: string;
  codec_name?: string;
  profile?: string;
  pix_fmt?: string;
  width?: number;
  height?: number;
  avg_frame_rate?: string;
  r_frame_rate?: string;
  sample_aspect_ratio?: string;
  color_space?: string;
  channels?: number;
  sample_rate?: string;
  tags?: { language?: string };
  disposition?: { attached_pic?: number };
}

const toNumber = (value: unknown): number | null => {
  const number = typeof value === 'string' || typeof value === 'number' ? Number(value) : NaN;
  return Number.isFinite(number) ? number : null;
};

/** "30000/1001" -> 29.97; "0/0" and garbage -> null. */
export function parseRatio(text: string | undefined): number | null {
  const match = /^(\d+(?:\.\d+)?)[/:](\d+(?:\.\d+)?)$/.exec(text ?? '');
  if (!match || Number(match[2]) === 0) return null;
  const value = Number(match[1]) / Number(match[2]);
  return value > 0 && Number.isFinite(value) ? value : null;
}

/** Turns the JSON printed by `ffprobe -show_format -show_streams` into a MediaInfo. */
export function parseProbe(json: unknown): MediaInfo {
  const data = (json ?? {}) as { streams?: RawStream[]; format?: { format_name?: string; duration?: string; size?: string } };
  const streams = data.streams ?? [];

  const rawVideo = streams.find((stream) => stream.codec_type === 'video' && !stream.disposition?.attached_pic);
  const video: VideoStream | null = rawVideo
    ? {
        index: rawVideo.index ?? 0,
        codec: rawVideo.codec_name ?? 'unknown',
        profile: rawVideo.profile ?? null,
        pixFmt: rawVideo.pix_fmt ?? null,
        width: rawVideo.width ?? 0,
        height: rawVideo.height ?? 0,
        frameRate: parseRatio(rawVideo.avg_frame_rate) ?? parseRatio(rawVideo.r_frame_rate),
        sampleAspectRatio: parseRatio(rawVideo.sample_aspect_ratio) ?? 1,
        colorSpace: rawVideo.color_space && rawVideo.color_space !== 'unknown' ? rawVideo.color_space : null,
      }
    : null;

  const audio = streams
    .filter((stream) => stream.codec_type === 'audio')
    .map(
      (stream): AudioStream => ({
        index: stream.index ?? 0,
        codec: stream.codec_name ?? 'unknown',
        channels: stream.channels ?? 0,
        sampleRate: toNumber(stream.sample_rate),
        language: stream.tags?.language ?? null,
      }),
    );

  const duration = toNumber(data.format?.duration);
  return {
    duration: duration !== null && duration > 0 ? duration : null,
    container: data.format?.format_name ?? '',
    size: toNumber(data.format?.size),
    video,
    audio,
  };
}

/** Reads codecs, streams and duration of a media file with ffprobe. Rejects when the file isn't readable media. */
export function probe(tools: FfmpegTools, file: string): Promise<MediaInfo> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      tools.ffprobe,
      ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file],
      { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true },
    );
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString()));
    child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()));
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) {
        const reason = stderr.trim().split(/\r?\n/).pop() || `ffprobe terminou com código ${code}`;
        reject(new Error(reason));
        return;
      }
      try {
        resolve(parseProbe(JSON.parse(stdout)));
      } catch {
        reject(new Error('Resposta inesperada do ffprobe.'));
      }
    });
  });
}
