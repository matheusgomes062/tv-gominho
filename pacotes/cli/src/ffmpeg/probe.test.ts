import { describe, expect, it } from 'vitest';
import { parseProbe } from './probe';

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
