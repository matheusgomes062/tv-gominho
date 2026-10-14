import { CONVERTIBLE_VIDEO, PLAYABLE_VIDEO, basename, dirname, extension, stripExtension } from '@tv-chuvisco/nucleo';
import type { MediaInfo } from '../ffmpeg/probe';

// Decisions are kept free of I/O (they only read probe data), so they are unit-tested without ffmpeg.

export type Action = 'skip' | 'remux' | 'convert';
type Mode = 'copy' | 'encode' | 'none';

export interface Plan {
  /**
   * skip: the file already plays everywhere; remux: only the container changes (seconds per file);
   * convert: at least one stream is re-encoded.
   */
  action: Action;
  video: Mode;
  audio: Mode;
  /** Why this action, in pt-BR, for the dry-run and the progress output. */
  reasons: string[];
  /** Set when the file can't be handled at all (no video, audio track that doesn't exist). */
  error: string | null;
}

export interface PlanOptions {
  /** Loudness normalization re-encodes the audio of files that are being converted anyway. */
  normalize?: boolean;
  /** Which audio stream to keep (0 = first). Only the first is checked for files that are skipped. */
  audioTrack?: number;
}

/** Containers the app can play as is, when the codecs inside are fine. */
const PLAYABLE_CONTAINER_NEEDS_CHECK = new Set(['mp4', 'm4v', 'mov']);

const SAFE_H264_PROFILES = new Set(['baseline', 'constrained baseline', 'main', 'high', 'extended']);
const SAFE_PIXEL_FORMATS = new Set(['yuv420p', 'yuvj420p']);

const CODEC_NAMES: Record<string, string> = {
  h264: 'H.264',
  hevc: 'HEVC (H.265)',
  mpeg4: 'MPEG-4 Parte 2',
  msmpeg4v3: 'MS-MPEG4 (DivX 3)',
  mpeg2video: 'MPEG-2',
  mpeg1video: 'MPEG-1',
  wmv1: 'WMV',
  wmv2: 'WMV',
  wmv3: 'WMV',
  vc1: 'VC-1',
  vp8: 'VP8',
  vp9: 'VP9',
  av1: 'AV1',
  aac: 'AAC',
  mp3: 'MP3',
  ac3: 'AC3',
  eac3: 'E-AC3',
  dts: 'DTS',
  flac: 'FLAC',
  opus: 'Opus',
  vorbis: 'Vorbis',
  wmav2: 'WMA',
  pcm_s16le: 'PCM',
};

export const codecName = (codec: string) => CODEC_NAMES[codec] ?? codec.toUpperCase();

/** Why the video would not play everywhere, or null when it is H.264 8-bit 4:2:0 in a common profile. */
function videoProblem(video: NonNullable<MediaInfo['video']>): string | null {
  if (video.codec !== 'h264') return `vídeo ${codecName(video.codec)} (precisa ser H.264)`;
  if (video.pixFmt && !SAFE_PIXEL_FORMATS.has(video.pixFmt)) {
    return /10|12/.test(video.pixFmt) ? 'vídeo H.264 de 10 bits' : `vídeo H.264 com formato de pixel ${video.pixFmt}`;
  }
  if (video.profile && !SAFE_H264_PROFILES.has(video.profile.toLowerCase())) {
    return `vídeo H.264 com perfil "${video.profile}"`;
  }
  return null;
}

/** For files that stay as they are: AAC and MP3 play in every browser and TV. */
const isSafeAudioCodec = (codec: string) => codec === 'aac' || codec === 'mp3';

/** AAC stereo can be copied into the new MP4 untouched. */
const canCopyAudio = (audio: MediaInfo['audio'][number]) => audio.codec === 'aac' && audio.channels > 0 && audio.channels <= 2;

/** Decides what to do with one video file, from what ffprobe found in it. */
export function planConversion(path: string, info: MediaInfo, options: PlanOptions = {}): Plan {
  const ext = extension(path);
  const track = options.audioTrack ?? 0;
  const fail = (error: string): Plan => ({ action: 'skip', video: 'none', audio: 'none', reasons: [], error });

  if (!info.video) return fail('O arquivo não tem vídeo.');

  const videoIssue = videoProblem(info.video);
  const firstAudio = info.audio[0];

  // Files the app plays today: leave them alone unless their codecs are the problem.
  if (PLAYABLE_VIDEO.has(ext)) {
    if (!PLAYABLE_CONTAINER_NEEDS_CHECK.has(ext)) {
      return { action: 'skip', video: 'copy', audio: 'copy', reasons: ['WebM já é tocado pelo navegador'], error: null };
    }
    const audioIssue = firstAudio && !isSafeAudioCodec(firstAudio.codec) ? `áudio ${codecName(firstAudio.codec)}` : null;
    if (!videoIssue && !audioIssue) {
      return { action: 'skip', video: 'copy', audio: 'copy', reasons: ['já é H.264 + AAC compatível'], error: null };
    }
  } else if (!CONVERTIBLE_VIDEO.has(ext)) {
    return fail(`Formato .${ext} não é um vídeo conhecido.`);
  }

  const audioStream = info.audio[track];
  if (track > 0 && !audioStream) {
    return fail(`O arquivo só tem ${info.audio.length} faixa(s) de áudio; a faixa ${track + 1} não existe.`);
  }

  const reasons: string[] = [];
  if (!PLAYABLE_VIDEO.has(ext)) reasons.push(`formato .${ext} não é suportado`);
  if (videoIssue) reasons.push(videoIssue);

  let audio: Mode = 'none';
  if (audioStream) {
    if (options.normalize) {
      audio = 'encode';
      reasons.push('normalizar o volume');
    } else if (canCopyAudio(audioStream)) {
      audio = 'copy';
    } else {
      audio = 'encode';
      reasons.push(
        audioStream.codec === 'aac' ? `áudio AAC com ${audioStream.channels} canais (será estéreo)` : `áudio ${codecName(audioStream.codec)} (será AAC)`,
      );
    }
  }

  const video: Mode = videoIssue ? 'encode' : 'copy';
  const action: Action = video === 'copy' && audio !== 'encode' ? 'remux' : 'convert';
  if (action === 'remux') reasons.push('só troca o contêiner, sem recodificar');
  return { action, video, audio, reasons, error: null };
}

// ---------------------------------------------------------------- paths

/** "programas/x/ep.avi" -> "programas/x/ep.mp4" */
export function targetPath(path: string): string {
  const dir = dirname(path);
  return `${dir ? `${dir}/` : ''}${stripExtension(basename(path))}.mp4`;
}

/**
 * Where ffmpeg writes before the file is renamed into place. It starts with a dot so
 * the library scan ignores leftovers of an interrupted run, and it is always ours to overwrite.
 */
export function tempPath(path: string): string {
  const dir = dirname(path);
  return `${dir ? `${dir}/` : ''}.${stripExtension(basename(path))}.parcial.mp4`;
}

/**
 * Where an original is moved to: `<root>.originais/<path inside the library>`.
 * `root` is the library prefix inside the picked folder ("" or "biblioteca/").
 */
export function originalsPath(root: string, path: string): string {
  return `${root}.originais/${path.slice(root.length)}`;
}

/** True when two library paths name the same file (Windows and macOS ignore case). */
export const samePath = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/** Adds " (2)", " (3)"... before the extension until `exists` says the name is free. */
export function freeName(path: string, exists: (candidate: string) => boolean): string {
  if (!exists(path)) return path;
  const dir = dirname(path);
  const stem = stripExtension(basename(path));
  const ext = extension(path);
  for (let n = 2; ; n++) {
    const candidate = `${dir ? `${dir}/` : ''}${stem} (${n})${ext ? `.${ext}` : ''}`;
    if (!exists(candidate)) return candidate;
  }
}

// ---------------------------------------------------------------- ffmpeg arguments

export interface EncodeOptions {
  /** x264 quality, 0-51; lower is better and bigger. */
  crf: number;
  preset: string;
  audioTrack?: number;
  /** Loudness target. Present only when --normalizar-audio is on. */
  loudness?: LoudnessTarget;
}

export interface LoudnessTarget {
  /** Integrated loudness in LUFS (-16 is the usual choice for streaming and TV). */
  integrated: number;
  truePeak: number;
  range: number;
  /** Measurements from a first pass, for accurate two-pass normalization. */
  measured?: LoudnormStats;
}

export const DEFAULT_LOUDNESS: LoudnessTarget = { integrated: -16, truePeak: -1.5, range: 11 };

export interface LoudnormStats {
  input_i: string;
  input_tp: string;
  input_lra: string;
  input_thresh: string;
  target_offset: string;
}

export function loudnormFilter(target: LoudnessTarget): string {
  const base = `loudnorm=I=${target.integrated}:TP=${target.truePeak}:LRA=${target.range}`;
  const m = target.measured;
  if (!m) return base;
  return `${base}:measured_I=${m.input_i}:measured_TP=${m.input_tp}:measured_LRA=${m.input_lra}:measured_thresh=${m.input_thresh}:offset=${m.target_offset}:linear=true`;
}

/** The loudnorm filter prints its measurements as a JSON object at the end of ffmpeg's log. */
export function parseLoudnormStats(log: string): LoudnormStats | null {
  const matches = log.match(/\{[^{}]*"input_i"[^{}]*\}/g);
  const last = matches?.[matches.length - 1];
  if (!last) return null;
  try {
    const data = JSON.parse(last) as Record<string, unknown>;
    const keys = ['input_i', 'input_tp', 'input_lra', 'input_thresh', 'target_offset'] as const;
    const stats = {} as LoudnormStats;
    for (const key of keys) {
      const value = data[key];
      // Silent files measure as "-inf"; the filter can't be tuned for them.
      if (typeof value !== 'string' || !Number.isFinite(Number(value))) return null;
      stats[key] = value;
    }
    return stats;
  } catch {
    return null;
  }
}

/** Arguments for the pass that measures loudness (no output file). */
export function loudnormMeasureArgs(input: string, options: EncodeOptions): string[] {
  const target = options.loudness ?? DEFAULT_LOUDNESS;
  const filter = `${loudnormFilter({ ...target, measured: undefined })}:print_format=json`;
  return ['-i', input, '-map', `0:a:${options.audioTrack ?? 0}`, '-vn', '-sn', '-dn', '-af', filter, '-f', 'null', '-'];
}

/** Full ffmpeg arguments (after the global flags) to write `output` as MP4 from `input`. */
export function buildConvertArgs(input: string, output: string, plan: Plan, options: EncodeOptions): string[] {
  const args = ['-i', input, '-map', '0:v:0'];
  if (plan.audio !== 'none') args.push('-map', `0:a:${options.audioTrack ?? 0}`);

  if (plan.video === 'encode') {
    args.push(
      '-c:v', 'libx264',
      '-preset', options.preset,
      '-crf', String(options.crf),
      '-profile:v', 'high',
      '-pix_fmt', 'yuv420p',
      // yuv420p needs even dimensions.
      '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2',
    );
  } else {
    args.push('-c:v', 'copy');
  }

  if (plan.audio === 'encode') {
    args.push('-c:a', 'aac', '-b:a', '160k', '-ar', '48000', '-ac', '2');
    if (options.loudness) args.push('-af', loudnormFilter(options.loudness));
  } else if (plan.audio === 'copy') {
    args.push('-c:a', 'copy');
  }

  // Subtitles and data streams are left out: MP4 can't hold most of them and the app has no use for them.
  args.push('-sn', '-dn', '-map_metadata', '0', '-movflags', '+faststart', '-f', 'mp4', '-y', output);
  return args;
}

// ---------------------------------------------------------------- validation

/**
 * Checks a converted file against its source. Returns a pt-BR problem description,
 * or null when the file looks right. Also used to decide whether an existing
 * `.mp4` next to an original is a finished conversion.
 */
export function validateOutput(source: MediaInfo, output: MediaInfo): string | null {
  if (!output.video) return 'o arquivo convertido não tem vídeo';
  const issue = videoProblem(output.video);
  if (issue) return `o arquivo convertido não ficou compatível (${issue})`;
  if (source.audio.length > 0 && output.audio.length === 0) return 'o arquivo convertido perdeu o áudio';
  if (source.duration !== null && output.duration !== null) {
    const tolerance = Math.max(2, source.duration * 0.02);
    if (Math.abs(source.duration - output.duration) > tolerance) {
      return `a duração do arquivo convertido (${Math.round(output.duration)} s) difere da original (${Math.round(source.duration)} s)`;
    }
  }
  return null;
}
