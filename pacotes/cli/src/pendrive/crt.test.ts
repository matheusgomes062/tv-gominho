import { describe, expect, it } from 'vitest';
import { CRT_PRESETS, MASK_GAIN, crtGraph, encodePpm, lensK1, lensZoom, maskPixels, type CrtLook } from './crt';

const LABELS = { input: '[pic]', mask: '[mask]', output: '[crt]' };
const look = (overrides: Partial<CrtLook> = {}): CrtLook => ({ intensity: 'medium', curvature: 50, scanlines: true, ...overrides });
const graph = (value: CrtLook, width = 960, height = 720) => crtGraph(value, width, height, LABELS).join(';');

describe('lens distortion', () => {
  it('is none at 0 and matches the app (0.15 at 100) elsewhere', () => {
    expect(lensK1(0)).toBe(0);
    expect(lensK1(50)).toBeCloseTo(0.075, 6);
    expect(lensK1(100)).toBeCloseTo(0.15, 6);
    expect(lensK1(250)).toBeCloseTo(0.15, 6);
    expect(lensK1(-5)).toBe(0);
  });

  it('zooms in just enough to keep the middle of the edges in place, and not at all for a flat screen', () => {
    expect(lensZoom(0)).toBe(1);
    expect(lensZoom(100)).toBeCloseTo(1.096, 3);
    expect(lensZoom(50)).toBeGreaterThan(1);
  });
});

describe('crtGraph', () => {
  it('has every part of the look at the default setting, in order', () => {
    const text = graph(look());
    const order = ['gblur', 'blend=all_mode=lighten', 'rgbashift', 'lenscorrection', 'noise', 'lut2'];
    const positions = order.map((name) => text.indexOf(name));
    expect(positions.every((position) => position >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    expect(text.startsWith('[pic]split')).toBe(true);
    expect(text.endsWith('[crt]')).toBe(true);
    expect(text).toContain('[mask]');
  });

  it('leaves out the lens correction at curvature 0 (and the zoom that goes with it)', () => {
    const text = graph(look({ curvature: 0 }));
    expect(text).not.toContain('lenscorrection');
    expect(text).not.toContain('crop=');
    expect(text).toContain('lut2');
  });

  it('passes the curvature to lenscorrection as k1 with black for the unmapped corners', () => {
    expect(graph(look({ curvature: 80 }))).toContain('lenscorrection=k1=0.12:k2=0:i=bilinear:fc=black');
    expect(graph(look({ curvature: 100 }))).toContain('k1=0.15');
    expect(graph(look({ curvature: 10 }))).toContain('k1=0.015');
  });

  it('crops back to the picture size after the zoom', () => {
    expect(graph(look({ curvature: 100 }), 960, 720)).toMatch(/scale=1052:789:flags=bicubic,crop=960:720/);
    expect(graph(look({ curvature: 100 }), 1280, 720)).toMatch(/crop=1280:720/);
  });

  it('scales the strength with the intensity', () => {
    expect(graph(look({ intensity: 'soft' }))).toContain(`all_opacity=${CRT_PRESETS.soft.bloom}`);
    expect(graph(look({ intensity: 'strong' }))).toContain(`all_opacity=${CRT_PRESETS.strong.bloom}`);
    expect(graph(look({ intensity: 'soft' }))).not.toContain('rgbashift');
    expect(graph(look({ intensity: 'medium' }))).toContain('rgbashift=rh=-1:bh=1');
    expect(graph(look({ intensity: 'strong' }))).toContain('rgbashift=rh=-2:bh=2');
    expect(graph(look({ intensity: 'strong' }))).toContain(`noise=alls=${CRT_PRESETS.strong.grain}`);
  });

  it('multiplies by the mask with the gain the mask was stored with, and ends with the shortest input', () => {
    const text = graph(look());
    expect(text).toContain(`x*y*${MASK_GAIN}/255+${CRT_PRESETS.medium.lift}`);
    expect(text).toContain('shortest=1');
  });
});

describe('maskPixels', () => {
  const pixel = (mask: Uint8Array, width: number, x: number, y: number, channel = 1) => mask[(y * width + x) * 3 + channel]!;

  it('is width x height x 3 bytes', () => {
    expect(maskPixels(look(), 96, 72).length).toBe(96 * 72 * 3);
  });

  it('has scanlines: a bright line centre and a dark gap, repeating every 3 rows', () => {
    const mask = maskPixels(look({ intensity: 'medium' }), 90, 720);
    // Average 3 columns so the aperture grille (3 px stripes) does not matter.
    const rowValue = (y: number) => [0, 1, 2].reduce((sum, c) => sum + pixel(mask, 90, 45 + c, y), 0) / 3;
    const rows = [300, 301, 302].map(rowValue);
    expect(Math.max(...rows) - Math.min(...rows)).toBeGreaterThan(20);
    expect(rowValue(303)).toBeCloseTo(rows[0]!, 0);
    expect(rowValue(305)).toBeCloseTo(rows[2]!, 0);
  });

  it('has no scanlines or grille when they are off: only the vignette is left', () => {
    const mask = maskPixels(look({ scanlines: false }), 90, 720);
    expect(pixel(mask, 90, 45, 300)).toBe(pixel(mask, 90, 45, 301));
    expect(pixel(mask, 90, 45, 300)).toBe(pixel(mask, 90, 46, 300, 0));
  });

  it('darkens the corners more than the centre (vignette), more when strong', () => {
    const soft = maskPixels(look({ intensity: 'soft', scanlines: false }), 96, 72);
    const strong = maskPixels(look({ intensity: 'strong', scanlines: false }), 96, 72);
    const ratio = (mask: Uint8Array) => pixel(mask, 96, 1, 1) / pixel(mask, 96, 48, 36);
    expect(ratio(soft)).toBeLessThan(1);
    expect(ratio(strong)).toBeLessThan(ratio(soft));
  });

  it('is deterministic', () => {
    expect(Buffer.from(maskPixels(look(), 64, 48)).equals(Buffer.from(maskPixels(look(), 64, 48)))).toBe(true);
  });
});

describe('encodePpm', () => {
  it('writes a binary P6 header and the pixels', () => {
    const ppm = encodePpm(2, 1, new Uint8Array([1, 2, 3, 4, 5, 6]));
    expect(ppm.subarray(0, 11).toString('ascii')).toBe('P6\n2 1\n255\n');
    expect([...ppm.subarray(11)]).toEqual([1, 2, 3, 4, 5, 6]);
  });
});
