// The CRT look, made of ffmpeg filters (docs/pendrive.md). It approximates the app's WebGL shader
// (components/crt-renderer.ts): same presets, same maths where a filter allows it.
//
// Per-pixel work that does not change between frames (scanlines, aperture grille, vignette) is baked
// once into a "mask" image that every frame is multiplied by (lut2), which is far cheaper than
// computing it per frame with geq. The rest is ordinary filters: glow, colour fringing, barrel
// distortion, grain. Not reproduced: the animated parts (flicker, line wobble, tracking glitch).
//
// This module has no imports of its own (apart from types), so it is plain, testable maths.

export type CrtIntensity = 'soft' | 'medium' | 'strong';

export interface CrtLook {
  intensity: CrtIntensity;
  /** 0 (flat) to 100. */
  curvature: number;
  scanlines: boolean;
}

interface Preset {
  scan: number;
  mask: number;
  vignette: number;
  /** Colour fringing, in pixels (red moves left, blue right). */
  fringe: number;
  bloom: number;
  /** Grain strength for the `noise` filter. */
  grain: number;
  /** Lifted blacks, in 0-255 levels. */
  lift: number;
}

// scan, mask, vignette and bloom are the app's numbers. fringe, grain and lift are those of the app
// converted to pixels and 8-bit levels (grain is lower than the app's: noise is the costliest thing to compress).
export const CRT_PRESETS: Record<CrtIntensity, Preset> = {
  soft: { scan: 0.28, mask: 0.07, vignette: 0.25, fringe: 0, bloom: 0.3, grain: 1, lift: 1 },
  medium: { scan: 0.52, mask: 0.13, vignette: 0.4, fringe: 1, bloom: 0.42, grain: 2, lift: 2 },
  strong: { scan: 0.82, mask: 0.22, vignette: 0.62, fringe: 2, bloom: 0.6, grain: 4, lift: 3 },
};

/** The app's barrel distortion at curvature 100 (see MAX_CURV in crt-renderer.ts). */
export const MAX_DISTORTION = 0.15;
/** The mask stores value / MASK_GAIN so that factors above 1 (the scanline peaks) fit in 8 bits. */
export const MASK_GAIN = 1.5;

/** `lenscorrection` k1 for a curvature in percent. Positive bulges the picture like a tube; 0 is no distortion. */
export function lensK1(curvature: number): number {
  return Math.round(clamp(curvature, 0, 100) * MAX_DISTORTION * 10) / 1000;
}

/**
 * How much to enlarge the picture before the distortion so that, like the app's tube, the middle of
 * each edge stays where it was and only the corners are lost (radial distortion also pulls the edges in).
 */
export function lensZoom(curvature: number): number {
  return 1 + 0.64 * lensK1(curvature);
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const mix = (a: number, b: number, t: number) => a + (b - a) * t;
function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

/** RGB triplets (8 bits) of the static mask for a `width` x `height` picture. */
export function maskPixels(look: CrtLook, width: number, height: number): Uint8Array {
  const preset = CRT_PRESETS[look.intensity];
  const scan = look.scanlines ? preset.scan : 0;
  const grille = look.scanlines ? preset.mask : 0;
  const lines = clamp(Math.floor(height / 3), 120, 300);
  const sigma = 0.22; // the app widens the beam with brightness (0.16 to 0.3); this is the middle
  const offsets = [0, -1 / 3, 1 / 3];

  // The scanline factor only depends on the row, the stripes on the column.
  const rows = new Float64Array(height);
  for (let y = 0; y < height; y++) {
    const up = 1 - (y + 0.5) / height;
    const phase = up * lines - Math.floor(up * lines) - 0.5;
    const beam = Math.exp(-(phase * phase) / (2 * sigma * sigma));
    rows[y] = Math.sqrt(mix(1, beam, scan) * (1 + scan * 0.3));
  }
  const stripes = new Float64Array(width * 3);
  for (let x = 0; x < width; x++) {
    for (let c = 0; c < 3; c++) {
      const stripe = 0.5 + 0.5 * Math.cos(2 * Math.PI * ((x + 0.5) / 3 + offsets[c]!));
      stripes[x * 3 + c] = Math.sqrt(mix(1, stripe * 1.9, grille));
    }
  }

  const out = new Uint8Array(width * height * 3);
  for (let y = 0; y < height; y++) {
    const py = 2 * (1 - (y + 0.5) / height) - 1;
    for (let x = 0; x < width; x++) {
      const px = 2 * ((x + 0.5) / width) - 1;
      const vig = mix(1, smoothstep(1.55, 0.25, Math.hypot(px * 0.92, py)), preset.vignette);
      for (let c = 0; c < 3; c++) {
        const value = (rows[y]! * stripes[x * 3 + c]! * vig) / MASK_GAIN;
        out[(y * width + x) * 3 + c] = Math.round(clamp(value, 0, 1) * 255);
      }
    }
  }
  return out;
}

/** A binary PPM (P6) image: the simplest format ffmpeg reads and Node can write without a library. */
export function encodePpm(width: number, height: number, rgb: Uint8Array): Buffer {
  return Buffer.concat([Buffer.from(`P6\n${width} ${height}\n255\n`, 'ascii'), Buffer.from(rgb.buffer, rgb.byteOffset, rgb.byteLength)]);
}

/** Names of the filter pads the CRT graph reads and writes, with their brackets: "[pic]". */
export interface CrtLabels {
  /** The picture (planar RGB, `width` x `height`). */
  input: string;
  /** The mask image (planar RGB, same size). */
  mask: string;
  output: string;
}

/**
 * The CRT look as filter chains (join them with ';') from the labelled picture to the labelled output.
 * Order: glow, colour fringing, barrel distortion (the corners go black), grain, then the mask
 * (scanlines, grille, vignette) is multiplied in and the blacks are lifted a little.
 */
export function crtGraph(look: CrtLook, width: number, height: number, labels: CrtLabels): string[] {
  const preset = CRT_PRESETS[look.intensity];
  // Glow: the blurred picture lightens the original (the max of the two, at `bloom` strength), like the app's bloom.
  const chain: string[] = [`blend=all_mode=lighten:all_opacity=${preset.bloom}`];
  if (preset.fringe > 0) chain.push(`rgbashift=rh=${-preset.fringe}:bh=${preset.fringe}:edge=smear`);
  if (look.curvature > 0) {
    const zoom = lensZoom(look.curvature);
    chain.push(
      `scale=${Math.round(width * zoom)}:${Math.round(height * zoom)}:flags=bicubic`,
      `crop=${width}:${height}`,
      `lenscorrection=k1=${lensK1(look.curvature)}:k2=0:i=bilinear:fc=black`,
    );
  }
  if (preset.grain > 0) chain.push(`noise=alls=${preset.grain}:allf=t`);

  const level = `clip(x*y*${MASK_GAIN}/255+${preset.lift},0,255)`;
  return [
    `${labels.input}split[crt_a][crt_b]`,
    `[crt_b]gblur=sigma=3:steps=2[crt_g]`,
    `[crt_a][crt_g]${chain.join(',')}[crt_p]`,
    `[crt_p]${labels.mask}lut2=c0='${level}':c1='${level}':c2='${level}':shortest=1${labels.output}`,
  ];
}
