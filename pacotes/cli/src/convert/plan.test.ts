import { describe, expect, it } from 'vitest';
import type { AudioStream, MediaInfo, VideoStream } from '../ffmpeg/probe';
import {
  DEFAULT_LOUDNESS,
  buildConvertArgs,
  freeName,
  loudnormFilter,
  loudnormMeasureArgs,
  originalsPath,
  parseLoudnormStats,
  planConversion,
  targetPath,
  tempPath,
  validateOutput,
} from './plan';

const h264: VideoStream = { index: 0, codec: 'h264', profile: 'High', pixFmt: 'yuv420p', width: 640, height: 480 };
const aac: AudioStream = { index: 1, codec: 'aac', channels: 2, sampleRate: 48000, language: null };

function media(video: Partial<VideoStream> | null, audio: Partial<AudioStream>[] = [{}], duration: number | null = 60): MediaInfo {
  return {
    duration,
    container: '',
    size: null,
    video: video ? { ...h264, ...video } : null,
    audio: audio.map((stream, i) => ({ ...aac, index: i + 1, ...stream })),
  };
}

describe('planConversion', () => {
  it('skips an MP4 that is already H.264 + AAC', () => {
    expect(planConversion('programas/a/ep.mp4', media({}))).toMatchObject({ action: 'skip', error: null });
  });

  it('skips MP4 with MP3 audio, no audio at all, or WebM', () => {
    expect(planConversion('a.mp4', media({}, [{ codec: 'mp3' }])).action).toBe('skip');
    expect(planConversion('a.mp4', media({}, [])).action).toBe('skip');
    expect(planConversion('a.webm', media({ codec: 'vp9' }, [{ codec: 'opus' }])).action).toBe('skip');
  });

  it('only remuxes an MKV with H.264 + AAC stereo', () => {
    const plan = planConversion('a.mkv', media({}));
    expect(plan).toMatchObject({ action: 'remux', video: 'copy', audio: 'copy' });
    expect(plan.reasons.join(' ')).toContain('.mkv');
  });

  it('re-encodes the video of an AVI with MPEG-4 Part 2 and the MP3 audio too', () => {
    const plan = planConversion('a.avi', media({ codec: 'mpeg4', profile: 'Advanced Simple Profile' }, [{ codec: 'mp3' }]));
    expect(plan).toMatchObject({ action: 'convert', video: 'encode', audio: 'encode' });
    expect(plan.reasons.join(' ')).toContain('MPEG-4 Parte 2');
  });

  it('re-encodes only the audio when the video is fine (AC3 in an MKV, or in an MP4)', () => {
    expect(planConversion('a.mkv', media({}, [{ codec: 'ac3', channels: 6 }]))).toMatchObject({ action: 'convert', video: 'copy', audio: 'encode' });
    expect(planConversion('a.mp4', media({}, [{ codec: 'dts', channels: 6 }]))).toMatchObject({ action: 'convert', video: 'copy', audio: 'encode' });
  });

  it('converts playable-extension files with unsafe codecs', () => {
    expect(planConversion('a.mp4', media({ codec: 'hevc' })).video).toBe('encode');
    expect(planConversion('a.mp4', media({ pixFmt: 'yuv420p10le', profile: 'High 10' })).reasons.join(' ')).toContain('10 bits');
    expect(planConversion('a.mov', media({ profile: 'High 4:2:2', pixFmt: 'yuv422p' })).action).toBe('convert');
  });

  it('downmixes AAC with more than two channels instead of copying it', () => {
    expect(planConversion('a.mkv', media({}, [{ channels: 6 }]))).toMatchObject({ action: 'convert', video: 'copy', audio: 'encode' });
  });

  it('keeps no-audio files without an audio stream', () => {
    expect(planConversion('a.avi', media({}, []))).toMatchObject({ action: 'remux', audio: 'none' });
  });

  it('normalization re-encodes the audio of files that are converted, not of those that are skipped', () => {
    expect(planConversion('a.mkv', media({}), { normalize: true })).toMatchObject({ action: 'convert', video: 'copy', audio: 'encode' });
    expect(planConversion('a.mp4', media({}), { normalize: true }).action).toBe('skip');
  });

  it('reports files it cannot handle', () => {
    expect(planConversion('a.avi', media(null)).error).toMatch(/não tem vídeo/);
    expect(planConversion('a.mkv', media({}, [{}]), { audioTrack: 2 }).error).toMatch(/faixa 3/);
    expect(planConversion('a.txt', media({})).error).toMatch(/\.txt/);
  });
});

describe('paths', () => {
  it('maps a source to its MP4 target and hidden temp file', () => {
    expect(targetPath('programas/x/ep 01.avi')).toBe('programas/x/ep 01.mp4');
    expect(targetPath('ep.MKV')).toBe('ep.mp4');
    expect(tempPath('programas/x/ep 01.avi')).toBe('programas/x/.ep 01.parcial.mp4');
    expect(tempPath('ep.mp4')).toBe('.ep.parcial.mp4');
  });

  it('mirrors paths under .originais inside the library root', () => {
    expect(originalsPath('', 'programas/x/ep.avi')).toBe('.originais/programas/x/ep.avi');
    expect(originalsPath('biblioteca/', 'biblioteca/programas/x/ep.avi')).toBe('biblioteca/.originais/programas/x/ep.avi');
  });

  it('finds a free name for an original that was moved before', () => {
    const taken = new Set(['.originais/a/ep.avi', '.originais/a/ep (2).avi']);
    expect(freeName('.originais/a/ep.avi', (path) => taken.has(path))).toBe('.originais/a/ep (3).avi');
    expect(freeName('.originais/a/new.avi', (path) => taken.has(path))).toBe('.originais/a/new.avi');
  });
});

describe('buildConvertArgs', () => {
  const options = { crf: 20, preset: 'medium' };

  it('encodes video and audio to H.264 High + AAC 48 kHz stereo with faststart', () => {
    const plan = planConversion('a.avi', media({ codec: 'mpeg4' }, [{ codec: 'mp3' }]));
    const args = buildConvertArgs('in.avi', 'out.mp4', plan, options);
    expect(args.join(' ')).toContain('-c:v libx264 -preset medium -crf 20 -profile:v high -pix_fmt yuv420p');
    expect(args.join(' ')).toContain('-c:a aac -b:a 160k -ar 48000 -ac 2');
    expect(args.join(' ')).toContain('-movflags +faststart -f mp4 -y out.mp4');
    expect(args.slice(0, 2)).toEqual(['-i', 'in.avi']);
  });

  it('copies streams when remuxing and picks the chosen audio track', () => {
    const plan = planConversion('a.mkv', media({}, [{}, {}]));
    const args = buildConvertArgs('in.mkv', 'out.mp4', plan, { ...options, audioTrack: 1 });
    expect(args).toContain('copy');
    expect(args).not.toContain('libx264');
    expect(args.join(' ')).toContain('-map 0:a:1');
    expect(args.join(' ')).toContain('-c:a copy');
  });

  it('adds no audio mapping for silent files and applies loudnorm when asked', () => {
    const silent = planConversion('a.avi', media({}, []));
    expect(buildConvertArgs('i', 'o', silent, options).join(' ')).not.toContain('0:a');

    const plan = planConversion('a.mkv', media({}), { normalize: true });
    const args = buildConvertArgs('i', 'o', plan, { ...options, loudness: DEFAULT_LOUDNESS });
    expect(args.join(' ')).toContain('-af loudnorm=I=-16:TP=-1.5:LRA=11');
  });
});

describe('loudnorm', () => {
  const log = `[Parsed_loudnorm_0 @ 000001]
{
\t"input_i" : "-23.54",
\t"input_tp" : "-6.12",
\t"input_lra" : "5.20",
\t"input_thresh" : "-33.87",
\t"output_i" : "-16.48",
\t"target_offset" : "0.48"
}
`;

  it('reads the measurements printed by the first pass', () => {
    expect(parseLoudnormStats(log)).toEqual({
      input_i: '-23.54',
      input_tp: '-6.12',
      input_lra: '5.20',
      input_thresh: '-33.87',
      target_offset: '0.48',
    });
    expect(parseLoudnormStats('nothing here')).toBeNull();
    expect(parseLoudnormStats(log.replace('-23.54', '-inf'))).toBeNull();
  });

  it('builds the second-pass filter in linear mode', () => {
    const measured = parseLoudnormStats(log)!;
    expect(loudnormFilter({ ...DEFAULT_LOUDNESS, measured })).toBe(
      'loudnorm=I=-16:TP=-1.5:LRA=11:measured_I=-23.54:measured_TP=-6.12:measured_LRA=5.20:measured_thresh=-33.87:offset=0.48:linear=true',
    );
    expect(loudnormMeasureArgs('in.mkv', { crf: 20, preset: 'fast' }).join(' ')).toContain('print_format=json -f null -');
  });
});

describe('validateOutput', () => {
  const source = media({ codec: 'mpeg4' }, [{ codec: 'mp3' }], 100);

  it('accepts a compatible file with the same duration', () => {
    expect(validateOutput(source, media({}, [{}], 100.4))).toBeNull();
  });

  it('rejects missing video, lost audio, bad codecs and truncated files', () => {
    expect(validateOutput(source, media(null))).toMatch(/não tem vídeo/);
    expect(validateOutput(source, media({}, []))).toMatch(/perdeu o áudio/);
    expect(validateOutput(source, media({ codec: 'hevc' }, [{}], 100))).toMatch(/compatível/);
    expect(validateOutput(source, media({}, [{}], 40))).toMatch(/duração/);
  });

  it('ignores the duration when the source does not report one', () => {
    expect(validateOutput(media({}, [{}], null), media({}, [{}], 40))).toBeNull();
  });
});
