import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { MediaInfo } from '../ffmpeg';
import { checkFileSystem, checkName, checkVideo, moovBeforeMdat, type FileFacts } from './compat';

const info = (overrides: Partial<MediaInfo> = {}): MediaInfo => ({
  duration: 1800,
  container: 'mov,mp4,m4a,3gp,3g2,mj2',
  size: 100_000_000,
  bitRate: 600_000,
  video: { index: 0, codec: 'h264', profile: 'Main', pixFmt: 'yuv420p', width: 854, height: 480, frameRate: 30, sampleAspectRatio: 1, colorSpace: 'bt709', level: 31 },
  audio: [{ index: 1, codec: 'aac', channels: 2, sampleRate: 48000, language: null, profile: 'LC' }],
  ...overrides,
});
const facts = (overrides: Partial<FileFacts> = {}): FileFacts => ({ bytes: 100_000_000, info: info(), moovFirst: true, fileSystem: 'FAT32', ...overrides });
const messages = (findings: { message: string }[]) => findings.map((finding) => finding.message).join(' | ');

describe('checkVideo', () => {
  it('passes what tv-gominho pendrive renders', () => {
    expect(checkVideo(facts())).toEqual([]);
    const hd = info({ video: { ...info().video!, profile: 'High', level: 40, width: 1280, height: 720 } });
    expect(checkVideo(facts({ info: hd }))).toEqual([]);
  });

  it('flags what TVs refuse', () => {
    const bad = info({
      container: 'rm',
      bitRate: 30_000_000,
      video: { ...info().video!, codec: 'h264', profile: 'High 10', pixFmt: 'yuv420p10le', level: 51, width: 3840, height: 2160, frameRate: 60 },
      audio: [{ index: 1, codec: 'dts', channels: 6, sampleRate: 96000, language: null }],
    });
    const findings = checkVideo(facts({ bytes: 5 * 1024 ** 3, info: bad, moovFirst: false }));
    expect(findings.filter((f) => f.severity === 'erro').length).toBeGreaterThanOrEqual(5);
    const text = messages(findings);
    for (const part of ['4 GB', 'formato rm', 'faststart', 'High 10', 'yuv420p10le', 'nível', '3840x2160', '60 quadros', '30 Mb/s', 'dts', '6 canais', '96 kHz']) expect(text).toContain(part);
  });

  it('only warns about MKV, Xvid and AVI', () => {
    const xvid = info({ container: 'avi', video: { ...info().video!, codec: 'mpeg4', profile: 'Advanced Simple Profile', level: 5 } });
    const findings = checkVideo(facts({ info: xvid }));
    expect(findings.map((f) => f.severity)).toEqual(['aviso', 'aviso']);
    expect(messages(findings)).toContain('AVI');
    expect(messages(findings)).toContain('DivX/Xvid');
  });

  it('only warns about big files on exFAT, and about HEVC and AC3', () => {
    const findings = checkVideo(
      facts({ bytes: 5 * 1024 ** 3, fileSystem: 'exFAT', info: info({ video: { ...info().video!, codec: 'hevc' }, audio: [{ index: 1, codec: 'ac3', channels: 2, sampleRate: 48000, language: null }] }) }),
    );
    expect(findings.every((f) => f.severity === 'aviso')).toBe(true);
    expect(findings).toHaveLength(3);
  });
});

describe('checkName', () => {
  it.each([
    ['Dia 01 - Parte 1.mp4', 0],
    ['Dia 01: Parte 1.mp4', 1],
    ['.oculto.mp4', 1],
    ['Dia 01.mkv', 0],
  ])('%s has %i errors', (name, errors) => {
    expect(checkName(name).filter((f) => f.severity === 'erro')).toHaveLength(errors);
  });

  it('warns about accents', () => {
    expect(checkName('Manhã.mp4')).toEqual([{ severity: 'aviso', message: expect.stringContaining('acentos') }]);
  });
});

describe('checkFileSystem', () => {
  it.each([
    ['FAT32', 0],
    ['vfat', 0],
    ['exFAT', 1],
    ['NTFS', 1],
    [null, 0],
  ])('%s', (fileSystem, count) => expect(checkFileSystem(fileSystem)).toHaveLength(count));
});

describe('moovBeforeMdat', () => {
  let dir: string;
  const box = (type: string, payload = 0) => {
    const buffer = Buffer.alloc(8 + payload);
    buffer.writeUInt32BE(8 + payload, 0);
    buffer.write(type, 4, 'latin1');
    return buffer;
  };
  beforeAll(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'tv-gominho-moov-'));
    await writeFile(path.join(dir, 'rapido.mp4'), Buffer.concat([box('ftyp', 8), box('moov', 20), box('mdat', 100)]));
    await writeFile(path.join(dir, 'lento.mp4'), Buffer.concat([box('ftyp', 8), box('mdat', 100), box('moov', 20)]));
    await writeFile(path.join(dir, 'lixo.mp4'), Buffer.from('not an mp4 at all'));
  });
  afterAll(() => rm(dir, { recursive: true, force: true }));

  it('finds where the index is', async () => {
    expect(await moovBeforeMdat(path.join(dir, 'rapido.mp4'))).toBe(true);
    expect(await moovBeforeMdat(path.join(dir, 'lento.mp4'))).toBe(false);
    expect(await moovBeforeMdat(path.join(dir, 'lixo.mp4'))).toBeNull();
  });
});
