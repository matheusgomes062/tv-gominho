import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { ffmpegCandidates, findOnPath, resolveExecutable, siblingProbe } from './locate';

const bin = mkdtempSync(path.join(tmpdir(), 'tv-gominho-bin-'));
const platform = process.platform;
const ffmpegName = platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
writeFileSync(path.join(bin, ffmpegName), '');
afterAll(() => rmSync(bin, { recursive: true, force: true }));

describe('siblingProbe', () => {
  it('finds ffprobe next to ffmpeg', () => {
    expect(siblingProbe(path.join('bin', 'ffmpeg.exe'), 'win32')).toBe(path.join('bin', 'ffprobe.exe'));
    expect(siblingProbe(path.join('bin', 'ffmpeg'), 'linux')).toBe(path.join('bin', 'ffprobe'));
  });
});

describe('ffmpegCandidates', () => {
  it('prefers the flag, then FFMPEG, then the PATH', () => {
    const flag = path.resolve('x', 'ffmpeg.exe');
    const variable = path.resolve('opt', 'ffmpeg');
    const candidates = ffmpegCandidates({ ffmpeg: flag, env: { FFMPEG: variable, PATH: bin }, platform });
    expect(candidates).toEqual([flag, variable, path.join(bin, ffmpegName)]);
    expect(ffmpegCandidates({ env: {}, platform: 'linux' })).toEqual([]);
  });
});

describe('findOnPath', () => {
  it('returns absolute paths and ignores relative PATH entries such as the current folder', () => {
    expect(findOnPath('ffmpeg', { PATH: bin }, platform)).toBe(path.join(bin, ffmpegName));
    expect(findOnPath('ffmpeg', { PATH: ['.', path.relative(process.cwd(), bin)].join(path.delimiter) }, platform)).toBeNull();
  });
});

describe('resolveExecutable', () => {
  it('keeps command names and file paths as they are', () => {
    expect(resolveExecutable('ffmpeg', 'ffmpeg', 'linux')).toBe('ffmpeg');
    expect(resolveExecutable('/nonexistent/ffmpeg', 'ffmpeg', 'linux')).toBe('/nonexistent/ffmpeg');
  });
});
