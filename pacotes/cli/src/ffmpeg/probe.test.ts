import { describe, expect, it } from 'vitest';
import { parseProbe, parseRatio } from './probe';

describe('parseProbe', () => {
  it('reads duration, video and audio streams', () => {
    const info = parseProbe({
      format: { format_name: 'matroska,webm', duration: '1422.5', size: '1048576' },
      streams: [
        { index: 0, codec_type: 'video', codec_name: 'hevc', profile: 'Main 10', pix_fmt: 'yuv420p10le', width: 1280, height: 720 },
        { index: 1, codec_type: 'audio', codec_name: 'ac3', channels: 6, sample_rate: '48000', tags: { language: 'por' } },
        { index: 2, codec_type: 'audio', codec_name: 'aac', channels: 2, sample_rate: '44100' },
        { index: 3, codec_type: 'subtitle', codec_name: 'subrip' },
      ],
    });
    expect(info.duration).toBe(1422.5);
    expect(info.size).toBe(1048576);
    expect(info.video).toMatchObject({ codec: 'hevc', pixFmt: 'yuv420p10le', width: 1280 });
    expect(info.audio).toEqual([
      { index: 1, codec: 'ac3', channels: 6, sampleRate: 48000, language: 'por' },
      { index: 2, codec: 'aac', channels: 2, sampleRate: 44100, language: null },
    ]);
  });

  it('ignores cover art and missing durations', () => {
    const info = parseProbe({
      format: { format_name: 'mov,mp4', duration: 'N/A' },
      streams: [
        { index: 0, codec_type: 'video', codec_name: 'mjpeg', disposition: { attached_pic: 1 } },
        { index: 1, codec_type: 'video', codec_name: 'h264', pix_fmt: 'yuv420p', width: 640, height: 480 },
      ],
    });
    expect(info.duration).toBeNull();
    expect(info.video?.codec).toBe('h264');
    expect(info.audio).toEqual([]);
  });

  it('copes with empty output', () => {
    expect(parseProbe({})).toMatchObject({ duration: null, video: null, audio: [] });
  });
});

describe('frame rate, pixel shape and colours', () => {
  it('reads them from the first video stream', () => {
    const info = parseProbe({
      format: { duration: '10' },
      streams: [
        { index: 0, codec_type: 'video', codec_name: 'h264', width: 720, height: 480, avg_frame_rate: '30000/1001', r_frame_rate: '30000/1001', sample_aspect_ratio: '32:27', color_space: 'smpte170m' },
      ],
    });
    expect(info.video!.frameRate).toBeCloseTo(29.97, 2);
    expect(info.video!.sampleAspectRatio).toBeCloseTo(32 / 27, 6);
    expect(info.video!.colorSpace).toBe('smpte170m');
  });

  it('falls back to the other rate, to square pixels and to unknown colours', () => {
    const info = parseProbe({ streams: [{ codec_type: 'video', codec_name: 'h264', avg_frame_rate: '0/0', r_frame_rate: '25/1', sample_aspect_ratio: '0:1', color_space: 'unknown' }] });
    expect(info.video).toMatchObject({ frameRate: 25, sampleAspectRatio: 1, colorSpace: null });
    expect(parseProbe({ streams: [{ codec_type: 'video', codec_name: 'h264' }] }).video).toMatchObject({ frameRate: null, sampleAspectRatio: 1 });
  });
});

describe('parseRatio', () => {
  it('parses fractions and rejects the rest', () => {
    expect(parseRatio('25/1')).toBe(25);
    expect(parseRatio('16:9')).toBeCloseTo(16 / 9, 6);
    expect(parseRatio('0/0')).toBeNull();
    expect(parseRatio('N/A')).toBeNull();
    expect(parseRatio(undefined)).toBeNull();
  });
});
