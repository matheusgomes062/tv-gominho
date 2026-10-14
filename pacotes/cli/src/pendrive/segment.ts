// How one piece of the rundown becomes a normalised intermediate MP4 (docs/pendrive.md): every piece comes out
// with the same codecs, size, frame rate and sample rate, so the pieces can be joined without re-encoding.
// This module only builds ffmpeg arguments and cache keys, so it is tested without ffmpeg.

import { createHash } from 'node:crypto';
import { loudnormFilter, DEFAULT_LOUDNESS, type LoudnormStats } from '../convert/plan';
import { crtGraph, type CrtLook } from './crt';

export const OUTPUT_WIDTH = 1280;
export const OUTPUT_HEIGHT = 720;
export const AUDIO_RATE = 48_000;
/** Bump when anything that changes the rendered pixels or sound changes: it invalidates the cached pieces. */
export const RENDER_VERSION = 1;

export type Aspect = '4:3' | 'stretch' | 'original';

export interface EncodeSettings {
  /** Constant frame rate of every piece (25 or 30). */
  fps: number;
  aspect: Aspect;
  /** The CRT look, or null for plain scaling. */
  crt: CrtLook | null;
  /** x264 quality (lower = better and bigger). */
  crf: number;
  preset: string;
}

/** Peak bitrate of the video: a cap that keeps the size predictable and inside what a TV's decoder takes. */
export const MAX_VIDEO_RATE = '6M';
export const VIDEO_BUFFER = '12M';

/** The area the picture occupies inside the 1280x720 frame: 4:3 is pillarboxed, the others fill it. */
export function pictureBox(aspect: Aspect): { width: number; height: number } {
  return aspect === '4:3' ? { width: 960, height: OUTPUT_HEIGHT } : { width: OUTPUT_WIDTH, height: OUTPUT_HEIGHT };
}

/** What the renderer needs to know about the source of a piece. */
export interface SegmentSource {
  /** Absolute path of the source file. */
  file: string;
  /** First frame (at the job's frame rate) to take, and how many. */
  startFrame: number;
  frames: number;
  hasAudio: boolean;
  /** For the colour conversion: SD files are BT.601, HD ones BT.709 unless the file says otherwise. */
  height: number;
  colorSpace: string | null;
  sampleAspectRatio: number;
  /** Loudness measurement of the whole file (two-pass normalisation), or null to leave the sound alone (silent file). */
  loudness: LoudnormStats | null;
}

/** The input's colour matrix as swscale names it. */
export function sourceMatrix(source: Pick<SegmentSource, 'height' | 'colorSpace'>): 'bt709' | 'bt601' {
  const space = source.colorSpace?.toLowerCase();
  if (space === 'bt709') return 'bt709';
  if (space === 'smpte170m' || space === 'bt470bg' || space === 'bt601') return 'bt601';
  return source.height >= 720 ? 'bt709' : 'bt601';
}

const trim = (value: number) => String(Number(value.toFixed(6)));

/** Seconds of a piece: its frames at the job's frame rate. */
export const secondsOf = (frames: number, fps: number) => frames / fps;

/** The filter graph (video and audio) of one piece. `maskInput` / `silenceInput` are the ffmpeg input indexes, or null when unused. */
export function segmentGraph(source: SegmentSource, settings: EncodeSettings, maskInput: number | null): { graph: string; video: string; audio: string } {
  const box = pictureBox(settings.aspect);
  const matrix = sourceMatrix(source);
  const chains: string[] = [];

  // ---- video
  const head = [
    `fps=${settings.fps}`,
    // The source ends a little early sometimes: repeat its last frame, the cut at the end is `-frames:v`.
    'tpad=stop_mode=clone:stop_duration=2',
  ];
  // Non-square pixels (DVD, old captures) become square before the aspect is fitted.
  if (Math.abs(source.sampleAspectRatio - 1) > 0.01) head.push(`scale=trunc(iw*${trim(source.sampleAspectRatio)}/2)*2:ih`);
  const fit =
    settings.aspect === 'stretch'
      ? `scale=${box.width}:${box.height}:flags=bicubic`
      : `scale=${box.width}:${box.height}:flags=bicubic:force_original_aspect_ratio=decrease:force_divisible_by=2`;
  const inColour = `in_color_matrix=${matrix}`;
  const outColour = 'out_color_matrix=bt709:out_range=tv';
  const padTo = (width: number, height: number) => `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:black`;

  if (settings.crt) {
    // Planar RGB for the effects; the picture is fitted into its box and the CRT is applied to that box.
    chains.push(`[0:v:0]${head.join(',')},${fit}:${inColour},format=gbrp,${padTo(box.width, box.height)}[pic]`);
    chains.push(`[${maskInput}:v]format=gbrp[mask]`);
    chains.push(...crtGraph(settings.crt, box.width, box.height, { input: '[pic]', mask: '[mask]', output: '[crt]' }));
    const frame = box.width < OUTPUT_WIDTH ? `,${padTo(OUTPUT_WIDTH, OUTPUT_HEIGHT)}` : '';
    chains.push(`[crt]scale=${outColour},format=yuv420p${frame},setsar=1[v]`);
  } else {
    chains.push(`[0:v:0]${head.join(',')},${fit}:${inColour}:${outColour},${padTo(OUTPUT_WIDTH, OUTPUT_HEIGHT)},format=yuv420p,setsar=1[v]`);
  }

  // ---- audio: stereo, 48 kHz, loudness matched to the other pieces, padded so it never ends before the picture.
  let audio = '[a]';
  if (source.hasAudio) {
    const levels = source.loudness ? `,${loudnormFilter({ ...DEFAULT_LOUDNESS, measured: source.loudness })}` : '';
    chains.push(`[0:a:0]aformat=channel_layouts=stereo${levels},aresample=${AUDIO_RATE},aformat=sample_fmts=fltp:channel_layouts=stereo,apad[a]`);
  } else {
    audio = `${maskInput === null ? 1 : 2}:a`;
  }
  return { graph: chains.join(';'), video: '[v]', audio };
}

/** Full ffmpeg arguments (after the global flags) that render `source` into the MP4 `output`. */
export function buildSegmentArgs(source: SegmentSource, settings: EncodeSettings, output: string, maskFile: string | null): string[] {
  const maskInput = settings.crt ? 1 : null;
  const { graph, video, audio } = segmentGraph(source, settings, maskInput);
  const seconds = secondsOf(source.frames, settings.fps);
  const args = ['-ss', trim(secondsOf(source.startFrame, settings.fps)), '-i', source.file];
  if (settings.crt) {
    if (!maskFile) throw new Error('The CRT look needs the mask image.');
    args.push('-loop', '1', '-framerate', String(settings.fps), '-i', maskFile);
  }
  if (!source.hasAudio) args.push('-f', 'lavfi', '-i', `anullsrc=r=${AUDIO_RATE}:cl=stereo`);

  args.push(
    '-filter_complex', graph,
    '-map', video,
    '-map', audio,
    // Exactly this many frames and this much sound: pieces are a whole number of frames long, so they join without drift.
    '-frames:v', String(source.frames),
    '-t', trim(seconds),
    '-fps_mode', 'cfr',
    '-c:v', 'libx264',
    '-preset', settings.preset,
    '-crf', String(settings.crf),
    '-maxrate', MAX_VIDEO_RATE,
    '-bufsize', VIDEO_BUFFER,
    '-profile:v', 'high',
    '-level:v', '4.0',
    '-pix_fmt', 'yuv420p',
    // A keyframe at least every two seconds (every piece starts with one), so skipping in the TV's player is quick.
    '-g', String(settings.fps * 2),
    '-colorspace', 'bt709',
    '-color_primaries', 'bt709',
    '-color_trc', 'bt709',
    '-color_range', 'tv',
    '-c:a', 'aac',
    '-b:a', '160k',
    '-ar', String(AUDIO_RATE),
    '-ac', '2',
    '-sn', '-dn',
    '-map_metadata', '-1',
    '-movflags', '+faststart',
    '-f', 'mp4',
    '-y', output,
  );
  return args;
}

/** ffmpeg arguments that measure a file's loudness (after the same stereo downmix the render uses). */
export function loudnessMeasureArgs(file: string): string[] {
  const filter = `aformat=channel_layouts=stereo,${loudnormFilter({ ...DEFAULT_LOUDNESS, measured: undefined })}:print_format=json`;
  return ['-i', file, '-map', '0:a:0', '-vn', '-sn', '-dn', '-af', filter, '-f', 'null', '-'];
}

/** Arguments that join already-rendered pieces (listed in `listFile`) into one MP4 without re-encoding. */
export function buildConcatArgs(listFile: string, output: string): string[] {
  return ['-f', 'concat', '-safe', '1', '-i', listFile, '-c', 'copy', '-map_metadata', '-1', '-movflags', '+faststart', '-f', 'mp4', '-y', output];
}

/** The concat demuxer's list: names relative to the list's own folder, quotes escaped. */
export function concatList(files: readonly string[]): string {
  return files.map((file) => `file '${file.replace(/'/g, "'\\''")}'`).join('\n') + '\n';
}

// ---------------------------------------------------------------- cache keys

/** What identifies a source file for the cache: where it is, how big and when it last changed. */
export interface FileIdentity {
  path: string;
  size: number;
  mtimeMs: number;
}

/** The settings that change what a rendered piece looks or sounds like. */
export function settingsFingerprint(settings: EncodeSettings): string {
  return JSON.stringify({
    v: RENDER_VERSION,
    fps: settings.fps,
    aspect: settings.aspect,
    // Only what the look uses: curvature changes nothing when it is 0, etc.
    crt: settings.crt && { i: settings.crt.intensity, c: Math.round(settings.crt.curvature), s: settings.crt.scanlines },
    crf: settings.crf,
    preset: settings.preset,
    loudness: DEFAULT_LOUDNESS.integrated,
  });
}

/** Cache key of a rendered piece: same file (path, size, mtime), same stretch of it, same settings = same piece. */
export function segmentKey(identity: FileIdentity, startFrame: number, frames: number, settings: EncodeSettings): string {
  return createHash('sha1')
    .update(JSON.stringify([identity.path, identity.size, Math.round(identity.mtimeMs), startFrame, frames, settingsFingerprint(settings)]))
    .digest('hex')
    .slice(0, 20);
}

/** Cache key of the loudness measurement of a file. */
export function loudnessKey(identity: FileIdentity): string {
  return createHash('sha1').update(JSON.stringify([identity.path, identity.size, Math.round(identity.mtimeMs), DEFAULT_LOUDNESS])).digest('hex').slice(0, 20);
}

/** Name of the intermediate file of a piece, inside the work folder. */
export const segmentFileName = (key: string) => `seg-${key}.mp4`;
