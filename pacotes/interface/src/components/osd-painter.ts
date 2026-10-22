// Paints the TV's on-screen display (channel OSD, "what's on" box, clock) to a 2D canvas, so the CRT shader
// can treat it as part of the picture (curvature, scanlines, mask, bloom...). It mirrors the DOM look in
// styles.css (`.osd-*`, `.skin-*`) rule by rule; keep the two in step. Used by components/Crt.tsx.
//
// All geometry is in CSS pixels of the tube (`.tv-screen`), `em` being the root font size, exactly as in the
// stylesheet; the canvas is scaled by `metrics.scale` to the WebGL drawing buffer.

import type { OsdSkin } from '@tv-gominho/nucleo';

export interface OsdState {
  skin: OsdSkin;
  /** The channel OSD (number, name, VHS timecode "SP 0:00:12"), or null while hidden. */
  channel: { number: number; name: string; timecode: string | null } | null;
  /** The "what's on" box, or null while hidden. */
  info: { title: string; subtitle: string | null } | null;
  /** The clock text ("20:30"), or null when the clock is off. */
  clock: string | null;
  /** The `marca_dagua` image, loaded, or null while hidden. */
  watermark: HTMLImageElement | null;
  /**
   * The bottom right corner belongs to the watermark: one is configured and on, even while it is hidden
   * (a bumper), so the VHS clock does not hop between corners at every break.
   */
  watermarkCorner: boolean;
}

/** Colours the stylesheet defines as custom properties. */
export interface OsdColors {
  osd: string;
  text: string;
  accent: string;
  accentText: string;
}

export interface OsdMetrics {
  /** Tube size in CSS pixels. */
  width: number;
  height: number;
  /** Canvas pixels per CSS pixel. */
  scale: number;
  /** The root font size in CSS pixels (1em in styles.css). */
  em: number;
  colors: OsdColors;
}

/** Opacity (0..1) of the transient parts; the clock never fades. */
export interface OsdFade {
  channel: number;
  info: number;
}

type Role = 'number' | 'title' | 'text';

/**
 * The font of each role per skin, mirroring `--ff-osd` (digits and ASCII only: Press Start 2P draws every
 * glyph on an 8x8 grid, so its accented capitals read as lowercase), `--ff-osd-title` (library names) and
 * `--ff-osd-text`. fonts.test.ts guards this table like it guards the CSS.
 */
export const OSD_FONTS: Record<OsdSkin, Record<Role, string>> = {
  classic: { number: 'Press Start 2P', title: 'Jersey 15', text: 'Jersey 15' },
  vhs: { number: 'VT323', title: 'VT323', text: 'VT323' },
  modern: { number: 'Figtree', title: 'Figtree', text: 'Figtree' },
};

const FALLBACK: Record<string, string> = {
  'Press Start 2P': "'Courier New', monospace",
  'Jersey 15': "'Figtree', sans-serif",
  VT323: "'Courier New', monospace",
  Figtree: "system-ui, 'Segoe UI', Roboto, sans-serif",
};

const family = (name: string) => `'${name}', ${FALLBACK[name] ?? 'sans-serif'}`;

/** Every font file (family + weight) a skin draws with. */
function fontFaces(skin: OsdSkin): Array<[string, number]> {
  if (skin === 'modern') return [['Figtree', 600], ['Figtree', 700], ['Figtree', 800]];
  const fonts = OSD_FONTS[skin];
  return [...new Set([fonts.number, fonts.title, fonts.text])].map((name) => [name, 400] as [string, number]);
}

const SAMPLE = 'CH 0123456789 SP:/ ÁÀÂÃÉÊÍÓÔÕÚÇ áàâãéêíóôõúç «»“”–…';

/** Resolves when the skin's fonts are loaded (the canvas cannot wait for a web font by itself). */
export async function loadOsdFonts(skin: OsdSkin): Promise<void> {
  if (typeof document === 'undefined' || !document.fonts) return;
  await Promise.all(fontFaces(skin).map(([name, weight]) => document.fonts.load(`${weight} 32px "${name}"`, SAMPLE).catch(() => [])));
}

/** Reads the colours from the stylesheet, so themes can change them. */
export function readOsdColors(element: Element): OsdColors {
  const style = getComputedStyle(element);
  const read = (name: string, fallback: string) => style.getPropertyValue(name).trim() || fallback;
  return {
    osd: read('--osd', '#5dff6a'),
    text: read('--text', '#f4f1e8'),
    accent: read('--accent', '#8aa4ff'),
    accentText: read('--accent-text', '#0a1233'),
  };
}

// --- text helpers ----------------------------------------------------------------------------------------

interface TextStyle {
  role: Role;
  weight?: number;
  /** Font size in CSS px. */
  size: number;
  color: string;
  /** Black outline thickness in CSS px (the stylesheet's `--edge` text-shadow); 0 for none. */
  edge?: number;
  /** Extra stroke in CSS px, in the text colour: heavier strokes survive scanlines and the shadow mask. */
  bold?: number;
  /** Letter spacing in CSS px. */
  spacing?: number;
  upper?: boolean;
  /** line-height as a multiple of the font size; undefined is `normal`. */
  lineHeight?: number;
}

interface Pen {
  ctx: CanvasRenderingContext2D;
  skin: OsdSkin;
}

/** Applies the font; returns the ascent and descent of the font box. */
function useFont(pen: Pen, style: TextStyle): { ascent: number; descent: number } {
  const { ctx, skin } = pen;
  ctx.font = `${style.weight ?? 400} ${style.size}px ${family(OSD_FONTS[skin][style.role])}`;
  ctx.letterSpacing = `${style.spacing ?? 0}px`;
  ctx.fontKerning = 'none';
  ctx.textRendering = 'optimizeSpeed';
  const m = ctx.measureText('Hxg');
  const ascent = m.fontBoundingBoxAscent ?? m.actualBoundingBoxAscent;
  const descent = m.fontBoundingBoxDescent ?? m.actualBoundingBoxDescent;
  return { ascent, descent };
}

const shape = (style: TextStyle, text: string) => (style.upper ? text.toLocaleUpperCase('pt-BR') : text);

function lineHeightOf(pen: Pen, style: TextStyle): number {
  if (style.lineHeight !== undefined) return style.lineHeight * style.size;
  const { ascent, descent } = useFont(pen, style);
  return ascent + descent;
}

function widthOf(pen: Pen, style: TextStyle, text: string): number {
  useFont(pen, style);
  return pen.ctx.measureText(shape(style, text)).width;
}

/** Greedy word wrap, like the browser's: a single word wider than the box stays on its own line. */
export function wrapWords(measure: (text: string) => number, text: string, maxWidth: number): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const next = line ? `${line} ${word}` : word;
    if (line && measure(next) > maxWidth) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines.length ? lines : [''];
}

function wrap(pen: Pen, style: TextStyle, text: string, maxWidth: number): string[] {
  return wrapWords((t) => widthOf(pen, style, t), text, Math.max(maxWidth, 1));
}

/** Draws one line inside a line box starting at `top`; `x` is the left edge, or the right edge for 'right'. */
function drawLine(pen: Pen, style: TextStyle, text: string, x: number, top: number, align: 'left' | 'right' = 'left'): void {
  const { ctx } = pen;
  const { ascent, descent } = useFont(pen, style);
  const lineHeight = style.lineHeight !== undefined ? style.lineHeight * style.size : ascent + descent;
  const baseline = top + (lineHeight - (ascent + descent)) / 2 + ascent;
  const shown = shape(style, text);
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = align;
  const bold = style.bold ?? 0;
  const edge = style.edge ? style.edge + bold / 2 : 0;
  ctx.lineJoin = 'round';
  if (edge > 0) {
    ctx.fillStyle = '#000';
    for (const [dx, dy] of EDGE_OFFSETS) ctx.fillText(shown, x + dx * edge, baseline + dy * edge);
  }
  ctx.fillStyle = style.color;
  ctx.fillText(shown, x, baseline);
  if (bold > 0) {
    ctx.strokeStyle = style.color;
    ctx.lineWidth = bold;
    ctx.strokeText(shown, x, baseline);
  }
}

const EDGE_OFFSETS = [
  [1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1],
] as const;

/** Rounded rectangle path (a plain rect where roundRect is missing). */
function roundedRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, radius: number): void {
  ctx.beginPath();
  if (typeof ctx.roundRect === 'function') ctx.roundRect(x, y, w, h, Math.min(radius, w / 2, h / 2));
  else ctx.rect(x, y, w, h);
}

// --- the skins -------------------------------------------------------------------------------------------

interface Frame {
  pen: Pen;
  w: number;
  h: number;
  em: number;
  colors: OsdColors;
}

/** Heavy, legible text under scanlines: the stylesheet's 0.09em edge, a touch thicker for small type. */
const edgeFor = (size: number) => Math.max(1, size * 0.09);

/** Extra stroke for small type, so it does not wash out under scanlines and the shadow mask. */
const heavy = (size: number) => size * 0.025;

/** `round(nearest, value, 8px)`: the pixel font stays on its 8px grid. */
const snap8 = (value: number) => Math.max(8, Math.round(value / 8) * 8);

const pad2 = (n: number) => String(n).padStart(2, '0');

// Classic: chunky pixel digits in green with a black edge; a bordered blue box.
function classic(f: Frame, state: OsdState, fade: OsdFade): void {
  const { pen, w, h, em, colors } = f;
  const { ctx } = pen;

  if (state.clock) {
    const size = Math.max(16, snap8(em * 1.05));
    drawLine(pen, { role: 'number', size, color: colors.osd, edge: edgeFor(size) }, state.clock, w * 0.06, h * 0.06);
  }

  if (state.channel && fade.channel > 0) {
    ctx.globalAlpha = fade.channel;
    const number: TextStyle = { role: 'number', size: snap8(em * 2.2), color: colors.osd, edge: edgeFor(em), upper: true, lineHeight: 1 };
    const name: TextStyle = { role: 'title', size: em * 1.7, color: colors.osd, edge: edgeFor(em), bold: heavy(em * 1.7), upper: true, lineHeight: 1.15 };
    const right = w * 0.94;
    const gap = em * 0.5;
    const y = h * 0.06;
    drawLine(pen, number, `CH ${pad2(state.channel.number)}`, right, y, 'right');
    let ny = y + number.size * number.lineHeight! + gap;
    for (const line of wrap(pen, name, state.channel.name, right)) {
      drawLine(pen, name, line, right, ny, 'right');
      ny += name.lineHeight! * name.size;
    }
    ctx.globalAlpha = 1;
  }

  if (state.info && fade.info > 0) {
    ctx.globalAlpha = fade.info;
    const border = em * 0.19;
    const padX = em * 1.3;
    const x = w * 0.06;
    const boxW = w * 0.88;
    const titleStyle: TextStyle = { role: 'title', size: em * 2.3, color: colors.osd, edge: edgeFor(em * 2.3), bold: heavy(em * 2.3), upper: true, lineHeight: 1.2 };
    const subStyle: TextStyle = { role: 'text', size: em * 1.55, color: colors.text, bold: heavy(em * 1.55) * 1.4, lineHeight: 1.15 };
    const inner = boxW - 2 * border - 2 * padX;
    const titleLines = wrap(pen, titleStyle, state.info.title, inner);
    const subLines = state.info.subtitle ? wrap(pen, subStyle, state.info.subtitle, inner) : [];
    const contentH =
      titleLines.length * titleStyle.lineHeight! * titleStyle.size +
      (subLines.length ? em * 0.5 + subLines.length * subStyle.lineHeight! * subStyle.size : 0);
    const boxH = 2 * border + em * 1 + em * 1.05 + contentH;
    const y = h * 0.93 - boxH;
    // Black ring outside the white border (box-shadow: 0 0 0 0.19em #000), then the fill, then the border.
    ctx.fillStyle = '#000';
    ctx.beginPath();
    ctx.rect(x - border, y - border, boxW + 2 * border, boxH + 2 * border);
    ctx.rect(x, y, boxW, boxH);
    ctx.fill('evenodd');
    ctx.fillStyle = 'rgb(4 10 36 / 0.86)';
    ctx.fillRect(x, y, boxW, boxH);
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.rect(x, y, boxW, boxH);
    ctx.rect(x + border, y + border, boxW - 2 * border, boxH - 2 * border);
    ctx.fill('evenodd');
    let ty = y + border + em * 1;
    for (const line of titleLines) {
      drawLine(pen, titleStyle, line, x + border + padX, ty);
      ty += titleStyle.lineHeight! * titleStyle.size;
    }
    if (subLines.length) {
      ty += em * 0.5;
      for (const line of subLines) {
        drawLine(pen, subStyle, line, x + border + padX, ty);
        ty += subStyle.lineHeight! * subStyle.size;
      }
    }
    ctx.globalAlpha = 1;
  }
}

// VHS: white blocky VCR capitals with a black edge, a "PLAY" triangle and a tape counter.
function vhs(f: Frame, state: OsdState, fade: OsdFade): void {
  const { pen, w, h, em } = f;
  const { ctx } = pen;
  const white = '#fff';

  if (state.channel && fade.channel > 0) {
    ctx.globalAlpha = fade.channel;
    const spacing = em * 0.05;
    const edge = edgeFor(em);
    const big: TextStyle = { role: 'number', size: em * 3.1, color: white, edge, bold: heavy(em * 3.1), spacing, upper: true, lineHeight: 1 };
    const play: TextStyle = { role: 'number', size: em * 3.1, color: white, edge, bold: heavy(em * 3.1), spacing, upper: true, lineHeight: 0.9 };
    const small: TextStyle = { role: 'title', size: em * 1.7, color: white, edge, bold: heavy(em * 1.7), spacing, upper: true, lineHeight: 1.15 };
    const tcStyle: TextStyle = { role: 'number', size: em * 1.7, color: white, edge, bold: heavy(em * 1.7), spacing, upper: true };
    const left = w * 0.06;
    const right = w * 0.94;
    const top = h * 0.07;
    const numberText = `CH ${pad2(state.channel.number)}`;
    const timecode = state.channel.timecode;
    const col2 = Math.max(widthOf(pen, big, numberText), timecode ? widthOf(pen, tcStyle, timecode) : 0);

    // Row 1: PLAY + triangle on the left, the channel number on the right.
    const rowOne = Math.max(big.size * big.lineHeight!, play.size * play.lineHeight!, play.size * 0.7);
    drawLine(pen, play, 'PLAY', left, top);
    const playWidth = widthOf(pen, play, 'PLAY');
    const triW = play.size * 0.62;
    const triH = play.size * 0.7;
    const triX = left + playWidth + play.size * 0.35;
    const triY = top + (play.size * play.lineHeight! - triH) / 2;
    const triangle = (dx: number, dy: number) => {
      ctx.beginPath();
      ctx.moveTo(triX + dx, triY + dy);
      ctx.lineTo(triX + triW + dx, triY + triH / 2 + dy);
      ctx.lineTo(triX + dx, triY + triH + dy);
      ctx.closePath();
      ctx.fill();
    };
    ctx.fillStyle = '#000';
    const s1 = play.size * 0.07;
    const s2 = play.size * 0.04;
    triangle(s1, s1);
    triangle(-s2, -s2);
    triangle(s1 - s2, s1 - s2);
    ctx.fillStyle = white;
    triangle(0, 0);
    drawLine(pen, big, numberText, right, top, 'right');

    // Row 2: the channel name (left) and the counter (right).
    const rowTwoTop = top + rowOne + em * 0.05;
    const nameLines = wrap(pen, small, state.channel.name, right - left - col2 - em * 0.5);
    let y = rowTwoTop;
    for (const line of nameLines) {
      drawLine(pen, small, line, left, y);
      y += small.lineHeight! * small.size;
    }
    if (timecode) drawLine(pen, tcStyle, timecode, right, rowTwoTop, 'right');
    ctx.globalAlpha = 1;
  }

  if (state.clock) {
    const size = em * 2.2;
    const style: TextStyle = { role: 'number', size, color: white, edge: edgeFor(size), bold: heavy(size), spacing: size * 0.05, upper: false };
    const height = lineHeightOf(pen, style);
    // The clock's corner is the watermark's: with a watermark on, the clock moves to the bottom left.
    if (state.watermarkCorner) drawLine(pen, style, state.clock, w * 0.06, h * 0.93 - height);
    else drawLine(pen, style, state.clock, w * 0.94, h * 0.93 - height, 'right');
  }

  if (state.info && fade.info > 0) {
    ctx.globalAlpha = fade.info;
    const spacing = em * 0.04;
    const x = w * 0.06;
    const boxW = w * 0.88;
    const padX = em * 1.2;
    const titleStyle: TextStyle = { role: 'title', size: em * 2.1, color: white, edge: edgeFor(em * 2.1), bold: heavy(em * 2.1), spacing, upper: true, lineHeight: 1 };
    const subStyle: TextStyle = { role: 'text', size: em * 1.8, color: 'rgb(255 255 255 / 0.92)', bold: heavy(em * 1.8) * 1.4, spacing, upper: true, lineHeight: 1.05 };
    const inner = boxW - 2 * padX;
    const titleLines = wrap(pen, titleStyle, state.info.title, inner);
    const subLines = state.info.subtitle ? wrap(pen, subStyle, state.info.subtitle, inner) : [];
    const border = em * 0.16;
    const contentH =
      titleLines.length * titleStyle.lineHeight! * titleStyle.size +
      (subLines.length ? em * 0.2 + subLines.length * subStyle.lineHeight! * subStyle.size : 0);
    const boxH = border + em * 0.8 + em * 0.9 + contentH;
    const y = h * 0.93 - boxH;
    const gradient = ctx.createLinearGradient(x, 0, x + boxW, 0);
    gradient.addColorStop(0, 'rgb(6 10 96 / 0.9)');
    gradient.addColorStop(1, 'rgb(6 10 96 / 0.6)');
    ctx.fillStyle = gradient;
    ctx.fillRect(x, y, boxW, boxH);
    ctx.fillStyle = white;
    ctx.fillRect(x, y, boxW, border);
    let ty = y + border + em * 0.8;
    for (const line of titleLines) {
      drawLine(pen, titleStyle, line, x + padX, ty);
      ty += titleStyle.lineHeight! * titleStyle.size;
    }
    if (subLines.length) {
      ty += em * 0.2;
      for (const line of subLines) {
        drawLine(pen, subStyle, line, x + padX, ty);
        ty += subStyle.lineHeight! * subStyle.size;
      }
    }
    ctx.globalAlpha = 1;
  }
}

/** A translucent pill / card with the stylesheet's soft drop shadow. */
function glass(f: Frame, x: number, y: number, w: number, h: number, radius: number, fill: string, shadow: boolean): void {
  const { ctx } = f.pen;
  const scale = f.pen.ctx.getTransform().a;
  ctx.save();
  if (shadow) {
    ctx.shadowColor = 'rgb(0 0 0 / 0.35)';
    ctx.shadowBlur = f.em * 1.5 * scale;
    ctx.shadowOffsetY = f.em * 0.5 * scale;
  }
  ctx.fillStyle = fill;
  roundedRect(ctx, x, y, w, h, radius);
  ctx.fill();
  ctx.restore();
}

// Modern: clean rounded sans on translucent pills, no outline.
function modern(f: Frame, state: OsdState, fade: OsdFade): void {
  const { pen, w, h, em, colors } = f;
  const { ctx } = pen;
  const white = '#fff';

  if (state.clock) {
    const size = em * 1.2;
    const style: TextStyle = { role: 'number', weight: 700, size, color: white, edge: size * 0.05, spacing: size * 0.02 };
    const textW = widthOf(pen, style, state.clock);
    const lineH = lineHeightOf(pen, style);
    const padX = size * 0.9;
    const padY = size * 0.25;
    const pillW = textW + 2 * padX;
    const pillH = lineH + 2 * padY;
    const x = w * 0.05;
    const y = h * 0.05;
    glass(f, x, y, pillW, pillH, 999, 'rgb(14 16 24 / 0.86)', false);
    drawLine(pen, style, state.clock, x + padX, y + padY);
  }

  if (state.channel && fade.channel > 0) {
    ctx.globalAlpha = fade.channel;
    const numSize = em * 1.3;
    const number: TextStyle = { role: 'number', weight: 800, size: numSize, color: colors.accentText, bold: numSize * 0.02, lineHeight: 1 };
    const name: TextStyle = { role: 'title', weight: 700, size: em * 1.15, color: white, edge: em * 0.06, lineHeight: 1.2 };
    const numText = pad2(state.channel.number);
    const circleH = numSize * 2.1;
    const circleW = Math.max(numSize * 2.1, widthOf(pen, number, numText));
    const padL = em * 0.35;
    const padR = em * 1.2;
    const gap = em * 0.7;
    const maxName = w * 0.9 - padL - padR - gap - circleW;
    let nameText = state.channel.name;
    while (nameText.length > 1 && widthOf(pen, name, nameText) > maxName) nameText = nameText.slice(0, -1);
    if (nameText !== state.channel.name) nameText = `${nameText.trimEnd()}…`;
    const nameW = widthOf(pen, name, nameText);
    const badgeH = Math.max(circleH, name.size * name.lineHeight!) + em * 0.7;
    const badgeW = padL + circleW + gap + nameW + padR;
    const x = w * 0.95 - badgeW;
    const y = h * 0.05;
    glass(f, x, y, badgeW, badgeH, 999, 'rgb(14 16 24 / 0.86)', true);
    const cx = x + padL;
    const cy = y + (badgeH - circleH) / 2;
    ctx.fillStyle = colors.accent;
    ctx.beginPath();
    ctx.ellipse(cx + circleW / 2, cy + circleH / 2, circleW / 2, circleH / 2, 0, 0, Math.PI * 2);
    ctx.fill();
    const numW = widthOf(pen, number, numText);
    drawLine(pen, number, numText, cx + (circleW - numW) / 2, cy + (circleH - numSize) / 2);
    drawLine(pen, name, nameText, cx + circleW + gap, y + (badgeH - name.size * name.lineHeight!) / 2);
    ctx.globalAlpha = 1;
  }

  if (state.info && fade.info > 0) {
    ctx.globalAlpha = fade.info;
    const x = w * 0.05;
    const boxW = w * 0.9;
    const padX = em * 1.3;
    const titleStyle: TextStyle = { role: 'title', weight: 800, size: em * 1.4, color: white, edge: em * 0.07, lineHeight: 1.2 };
    const subStyle: TextStyle = { role: 'text', weight: 600, size: em * 1.05, color: 'rgb(255 255 255 / 0.95)', bold: heavy(em * 1.05), lineHeight: 1.15 };
    const inner = boxW - 2 * padX;
    const titleLines = wrap(pen, titleStyle, state.info.title, inner);
    const subLines = state.info.subtitle ? wrap(pen, subStyle, state.info.subtitle, inner) : [];
    const contentH =
      titleLines.length * titleStyle.lineHeight! * titleStyle.size +
      (subLines.length ? em * 0.3 + subLines.length * subStyle.lineHeight! * subStyle.size : 0);
    const boxH = em * 1 + em * 1.05 + contentH;
    const y = h * 0.94 - boxH;
    glass(f, x, y, boxW, boxH, em * 1.4, 'rgb(14 16 24 / 0.88)', true);
    let ty = y + em * 1;
    for (const line of titleLines) {
      drawLine(pen, titleStyle, line, x + padX, ty);
      ty += titleStyle.lineHeight! * titleStyle.size;
    }
    if (subLines.length) {
      ty += em * 0.3;
      for (const line of subLines) {
        drawLine(pen, subStyle, line, x + padX, ty);
        ty += subStyle.lineHeight! * subStyle.size;
      }
    }
    ctx.globalAlpha = 1;
  }
}

// The watermark bug: bottom right of the picture, inside the safe area. `.tv-watermark` in styles.css is the same
// box for the plain (no CRT) screen; keep the two in step.
export const WATERMARK = {
  /** The biggest box the image fits in, as fractions of the tube. */
  maxWidth: 0.11,
  maxHeight: 0.2,
  /** Distance of the box from the bottom and right edges, as fractions of the tube (the classic skin's safe area). */
  margin: 0.06,
  opacity: 0.65,
} as const;

/** Where the watermark goes in a tube of `width` x `height`: contained in its box, anchored bottom right, aspect kept. */
export function watermarkRect(width: number, height: number, imageWidth: number, imageHeight: number) {
  const fit = Math.min((width * WATERMARK.maxWidth) / imageWidth, (height * WATERMARK.maxHeight) / imageHeight);
  const w = imageWidth * fit;
  const h = imageHeight * fit;
  return { x: width * (1 - WATERMARK.margin) - w, y: height * (1 - WATERMARK.margin) - h, width: w, height: h };
}

function drawWatermark(f: Frame, image: HTMLImageElement): void {
  if (!image.naturalWidth || !image.naturalHeight) return;
  const { ctx } = f.pen;
  const box = watermarkRect(f.w, f.h, image.naturalWidth, image.naturalHeight);
  ctx.globalAlpha = WATERMARK.opacity;
  ctx.drawImage(image, box.x, box.y, box.width, box.height);
  ctx.globalAlpha = 1;
}

const SKINS: Record<OsdSkin, (f: Frame, state: OsdState, fade: OsdFade) => void> = { classic, vhs, modern };

/**
 * Draws the whole OSD layer into `canvas` (cleared first, transparent where nothing is drawn).
 * The canvas is expected to be `metrics.width * scale` by `metrics.height * scale` pixels.
 */
export function paintOsd(canvas: HTMLCanvasElement | OffscreenCanvas, state: OsdState, metrics: OsdMetrics, fade: OsdFade = { channel: 1, info: 1 }): void {
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D | null;
  if (!ctx) return;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.globalAlpha = 1;
  ctx.setTransform(metrics.scale, 0, 0, metrics.scale, 0, 0);
  const frame: Frame = { pen: { ctx, skin: state.skin }, w: metrics.width, h: metrics.height, em: metrics.em, colors: metrics.colors };
  // Under the OSD text, like a broadcaster's bug under the graphics.
  if (state.watermark) drawWatermark(frame, state.watermark);
  SKINS[state.skin](frame, state, fade);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
}
