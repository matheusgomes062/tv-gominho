import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ffmpegCandidates, resolveExecutable, siblingProbe } from './locate';

describe('siblingProbe', () => {
  it('finds ffprobe next to ffmpeg', () => {
    expect(siblingProbe(path.join('bin', 'ffmpeg.exe'), 'win32')).toBe(path.join('bin', 'ffprobe.exe'));
    expect(siblingProbe(path.join('bin', 'ffmpeg'), 'linux')).toBe(path.join('bin', 'ffprobe'));
  });
});

describe('ffmpegCandidates', () => {
  it('prefers the flag, then FFMPEG, then the PATH', () => {
    const candidates = ffmpegCandidates({ ffmpeg: 'C:/x/ffmpeg.exe', env: { FFMPEG: '/opt/ffmpeg' }, platform: 'linux' });
    expect(candidates).toEqual(['C:/x/ffmpeg.exe', '/opt/ffmpeg', 'ffmpeg']);
    expect(ffmpegCandidates({ env: {}, platform: 'linux' })).toEqual(['ffmpeg']);
  });
});

describe('resolveExecutable', () => {
  it('keeps command names and file paths as they are', () => {
    expect(resolveExecutable('ffmpeg', 'ffmpeg', 'linux')).toBe('ffmpeg');
    expect(resolveExecutable('/nonexistent/ffmpeg', 'ffmpeg', 'linux')).toBe('/nonexistent/ffmpeg');
  });
});
