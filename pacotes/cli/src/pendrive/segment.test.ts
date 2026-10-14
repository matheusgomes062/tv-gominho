import { describe, expect, it } from 'vitest';
import type { CrtLook } from './crt';
import {
  buildConcatArgs,
  buildSegmentArgs,
  concatList,
  loudnessKey,
  loudnessMeasureArgs,
  pictureBox,
  segmentFileName,
  segmentGraph,
  segmentKey,
  settingsFingerprint,
  sourceMatrix,
  type EncodeSettings,
  type SegmentSource,
} from './segment';

const crtLook: CrtLook = { intensity: 'medium', curvature: 50, scanlines: true };
const encode = (overrides: Partial<EncodeSettings> = {}): EncodeSettings => ({ fps: 30, aspect: '4:3', crt: crtLook, crf: 22, preset: 'veryfast', ...overrides });
const source = (overrides: Partial<SegmentSource> = {}): SegmentSource => ({
  file: 'C:\\biblioteca\\programas\\a\\001.mp4',
  startFrame: 0,
  frames: 300,
  hasAudio: true,
  height: 480,
  colorSpace: null,
  sampleAspectRatio: 1,
  loudness: null,
  ...overrides,
});
const LOUDNESS = { input_i: '-23.50', input_tp: '-4.10', input_lra: '6.00', input_thresh: '-34.00', target_offset: '0.30' };

const argsOf = (src = source(), settings = encode()) => buildSegmentArgs(src, settings, 'out.mp4', settings.crt ? 'mask.ppm' : null);
const after = (args: string[], flag: string) => args[args.indexOf(flag) + 1];

describe('output format', () => {
  it('is H.264 High 4.0, yuv420p, AAC stereo 48 kHz 160k, constant frame rate, faststart MP4', () => {
    const args = argsOf();
    expect(after(args, '-c:v')).toBe('libx264');
    expect(after(args, '-profile:v')).toBe('high');
    expect(after(args, '-level:v')).toBe('4.0');
    expect(after(args, '-pix_fmt')).toBe('yuv420p');
    expect(after(args, '-c:a')).toBe('aac');
    expect(after(args, '-b:a')).toBe('160k');
    expect(after(args, '-ar')).toBe('48000');
    expect(after(args, '-ac')).toBe('2');
    expect(after(args, '-fps_mode')).toBe('cfr');
    expect(after(args, '-movflags')).toBe('+faststart');
    expect(after(args, '-f')).toBe('mp4');
    expect(args.at(-1)).toBe('out.mp4');
  });

  it('caps the bitrate so sizes are predictable, and tags the colours as BT.709', () => {
    const args = argsOf();
    expect(after(args, '-maxrate')).toBe('6M');
    expect(after(args, '-bufsize')).toBe('12M');
    expect(after(args, '-colorspace')).toBe('bt709');
    expect(after(args, '-color_range')).toBe('tv');
  });

  it('takes exactly the frames and sound asked for, from the right place in the file', () => {
    const args = argsOf(source({ startFrame: 450, frames: 99 }));
    expect(after(args, '-ss')).toBe('15');
    expect(after(args, '-frames:v')).toBe('99');
    expect(after(args, '-t')).toBe('3.3');
    // The seek comes before the input it applies to.
    expect(args.indexOf('-ss')).toBeLessThan(args.indexOf('-i'));
  });

  it('uses the chosen quality, preset and frame rate', () => {
    const args = argsOf(source({ frames: 250 }), encode({ crf: 18, preset: 'slow', fps: 25 }));
    expect(after(args, '-crf')).toBe('18');
    expect(after(args, '-preset')).toBe('slow');
    expect(after(args, '-g')).toBe('50');
    expect(after(args, '-t')).toBe('10');
    expect(segmentGraph(source(), encode({ fps: 25 }), 1).graph).toContain('fps=25,');
  });

  it('writes no metadata, subtitles or data streams', () => {
    const args = argsOf();
    expect(args).toContain('-sn');
    expect(args).toContain('-dn');
    expect(after(args, '-map_metadata')).toBe('-1');
  });
});

describe('picture', () => {
  it('pillarboxes 4:3 inside 1280x720 and fills the frame when stretched', () => {
    expect(pictureBox('4:3')).toEqual({ width: 960, height: 720 });
    expect(pictureBox('stretch')).toEqual({ width: 1280, height: 720 });
    expect(pictureBox('original')).toEqual({ width: 1280, height: 720 });
  });

  it('without the CRT it is plain scaling: no effect filters, no mask input', () => {
    const args = argsOf(source(), encode({ crt: null }));
    const graph = after(args, '-filter_complex')!;
    for (const name of ['lenscorrection', 'lut2', 'gblur', 'noise', 'rgbashift', 'gbrp', 'blend']) expect(graph).not.toContain(name);
    expect(graph).toContain('scale=960:720:flags=bicubic:force_original_aspect_ratio=decrease');
    expect(graph).toContain('pad=1280:720:(ow-iw)/2:(oh-ih)/2:black');
    expect(args.filter((arg) => arg === '-i')).toHaveLength(1);
    expect(args).not.toContain('-loop');
  });

  it('with the CRT it adds the mask as a looping second input and works in planar RGB', () => {
    const args = argsOf();
    expect(args.slice(args.indexOf('-loop'), args.indexOf('-loop') + 6)).toEqual(['-loop', '1', '-framerate', '30', '-i', 'mask.ppm']);
    const graph = after(args, '-filter_complex')!;
    expect(graph).toContain('[1:v]format=gbrp[mask]');
    expect(graph).toContain('format=gbrp,pad=960:720');
    expect(graph).toContain('lenscorrection');
    // The CRT is applied to the 4:3 picture, then the frame is pillarboxed.
    expect(graph.indexOf('lenscorrection')).toBeLessThan(graph.indexOf('pad=1280:720'));
    expect(graph).toContain('pad=1280:720:(ow-iw)/2:(oh-ih)/2:black,setsar=1[v]');
  });

  it('stretches to the full frame, with no bars', () => {
    const plain = segmentGraph(source(), encode({ crt: null, aspect: 'stretch' }), null).graph;
    expect(plain).toContain('scale=1280:720:flags=bicubic:');
    expect(plain).not.toContain('force_original_aspect_ratio');
    const crt = segmentGraph(source(), encode({ aspect: 'stretch' }), 1).graph;
    expect(crt).toContain('crop=1280:720');
    expect(crt).not.toContain('pad=1280:720:(ow-iw)/2:(oh-ih)/2:black,setsar');
  });

  it('keeps the original shape inside 1280x720 for the "original" aspect', () => {
    const graph = segmentGraph(source(), encode({ crt: null, aspect: 'original' }), null).graph;
    expect(graph).toContain('scale=1280:720:flags=bicubic:force_original_aspect_ratio=decrease');
  });

  it.each([
    ['soft', 0, true],
    ['medium', 50, true],
    ['strong', 100, false],
    ['medium', 0, false],
  ] as const)('builds a graph for %s, curvature %i, scanlines %s', (intensity, curvature, scanlines) => {
    const graph = segmentGraph(source(), encode({ crt: { intensity, curvature, scanlines } }), 1).graph;
    expect(graph.startsWith('[0:v:0]fps=30')).toBe(true);
    expect(graph).toContain('[v]');
    expect(graph.includes('lenscorrection')).toBe(curvature > 0);
    // Every opened pad is used: a label that appears once would make ffmpeg fail.
    for (const label of new Set(graph.match(/\[[a-z_0-9:]+\]/gi))) {
      if (/^\[\d/.test(label) || label === '[v]' || label === '[a]') continue;
      expect(graph.split(label).length - 1, label).toBeGreaterThanOrEqual(2);
    }
  });

  it('squares non-square pixels before fitting, and only then', () => {
    expect(segmentGraph(source({ sampleAspectRatio: 32 / 27 }), encode(), 1).graph).toContain('scale=trunc(iw*1.185185/2)*2:ih');
    expect(segmentGraph(source({ sampleAspectRatio: 1 }), encode(), 1).graph).not.toContain('trunc(iw*');
  });

  it('converts the colours from the matrix the source uses to BT.709', () => {
    expect(sourceMatrix({ height: 480, colorSpace: null })).toBe('bt601');
    expect(sourceMatrix({ height: 1080, colorSpace: null })).toBe('bt709');
    expect(sourceMatrix({ height: 480, colorSpace: 'bt709' })).toBe('bt709');
    expect(sourceMatrix({ height: 1080, colorSpace: 'smpte170m' })).toBe('bt601');
    expect(segmentGraph(source({ height: 480 }), encode({ crt: null }), null).graph).toContain('in_color_matrix=bt601:out_color_matrix=bt709:out_range=tv');
  });
});

describe('audio', () => {
  it('is mixed to stereo at 48 kHz and padded so it never ends early', () => {
    const graph = segmentGraph(source(), encode(), 1).graph;
    expect(graph).toContain('[0:a:0]aformat=channel_layouts=stereo');
    expect(graph).toContain('aresample=48000');
    expect(graph).toContain('apad[a]');
  });

  it('is normalised with the loudness measured on the whole file, so every act of an episode gets the same gain', () => {
    const graph = segmentGraph(source({ loudness: LOUDNESS }), encode(), 1).graph;
    expect(graph).toContain('loudnorm=I=-16:TP=-1.5:LRA=11:measured_I=-23.50:measured_TP=-4.10:measured_LRA=6.00:measured_thresh=-34.00:offset=0.30:linear=true');
    expect(segmentGraph(source({ loudness: null }), encode(), 1).graph).not.toContain('loudnorm');
  });

  it('is generated silence for a file without sound', () => {
    const withMask = argsOf(source({ hasAudio: false }));
    expect(withMask).toContain('anullsrc=r=48000:cl=stereo');
    expect(after(withMask, '-filter_complex')).not.toContain('[0:a');
    expect(withMask[withMask.lastIndexOf('-map') + 1]).toBe('2:a');
    const plain = argsOf(source({ hasAudio: false }), encode({ crt: null }));
    expect(plain[plain.lastIndexOf('-map') + 1]).toBe('1:a');
  });

  it('measures with the same downmix and target', () => {
    const args = loudnessMeasureArgs('in.mp4');
    expect(after(args, '-af')).toBe('aformat=channel_layouts=stereo,loudnorm=I=-16:TP=-1.5:LRA=11:print_format=json');
    expect(args).toContain('-vn');
    expect(args.slice(-3)).toEqual(['-f', 'null', '-']);
  });
});

describe('concatenation', () => {
  it('joins without re-encoding', () => {
    const args = buildConcatArgs('list.txt', 'out.mp4');
    expect(args).toEqual(['-f', 'concat', '-safe', '1', '-i', 'list.txt', '-c', 'copy', '-map_metadata', '-1', '-movflags', '+faststart', '-f', 'mp4', '-y', 'out.mp4']);
  });

  it('lists the pieces in order, escaping quotes', () => {
    expect(concatList(['seg-a.mp4', "seg-b'c.mp4"])).toBe("file 'seg-a.mp4'\nfile 'seg-b'\\''c.mp4'\n");
  });
});

describe('cache keys', () => {
  const identity = { path: 'C:\\biblioteca\\a.mp4', size: 1000, mtimeMs: 1_700_000_000_000 };
  const key = (overrides: { identity?: typeof identity; start?: number; frames?: number; settings?: EncodeSettings } = {}) =>
    segmentKey(overrides.identity ?? identity, overrides.start ?? 0, overrides.frames ?? 300, overrides.settings ?? encode());

  it('is stable for the same piece and settings', () => {
    expect(key()).toBe(key());
    expect(key()).toMatch(/^[0-9a-f]{20}$/);
    expect(segmentFileName(key())).toBe(`seg-${key()}.mp4`);
  });

  it('changes with the file (path, size, date), the stretch of it and any setting that changes the picture or sound', () => {
    const base = key();
    const different = [
      key({ identity: { ...identity, path: 'C:\\biblioteca\\b.mp4' } }),
      key({ identity: { ...identity, size: 1001 } }),
      key({ identity: { ...identity, mtimeMs: identity.mtimeMs + 5000 } }),
      key({ start: 30 }),
      key({ frames: 301 }),
      key({ settings: encode({ fps: 25 }) }),
      key({ settings: encode({ aspect: 'stretch' }) }),
      key({ settings: encode({ crt: null }) }),
      key({ settings: encode({ crt: { ...crtLook, intensity: 'strong' } }) }),
      key({ settings: encode({ crt: { ...crtLook, curvature: 80 } }) }),
      key({ settings: encode({ crt: { ...crtLook, scanlines: false } }) }),
      key({ settings: encode({ crf: 18 }) }),
      key({ settings: encode({ preset: 'slow' }) }),
    ];
    for (const other of different) expect(other).not.toBe(base);
    expect(new Set(different).size).toBe(different.length);
  });

  it('ignores sub-millisecond noise in the file date', () => {
    expect(key({ identity: { ...identity, mtimeMs: identity.mtimeMs + 0.4 } })).toBe(key());
  });

  it('has its own key for the loudness measurement, from the file only', () => {
    expect(loudnessKey(identity)).toBe(loudnessKey({ ...identity }));
    expect(loudnessKey(identity)).not.toBe(loudnessKey({ ...identity, size: 2 }));
  });

  it('fingerprints the settings deterministically', () => {
    expect(settingsFingerprint(encode())).toBe(settingsFingerprint(encode()));
    expect(settingsFingerprint(encode({ crt: null }))).not.toBe(settingsFingerprint(encode()));
  });
});
