const MAX_SIDE = 384;
const PAD = 10;

/**
 * The bundled logo as a "glass" broadcaster bug: frosted (light, nearly colourless), with a thin light edge on the
 * upper left and a soft dark glow so it reads on bright and dark scenes. Rendered once into a PNG data URL, so
 * both the CRT painter and the plain screen's `<img>` just draw a normal image (nothing per frame, light on a Pi).
 * The painter's own opacity is applied on top, so the bug ends up around 60% opaque, the frosted body letting the picture show through.
 */
export function glassDataUrl(image: HTMLImageElement): string | null {
  if (!image.naturalWidth || !image.naturalHeight) return null;
  const fit = Math.min(1, MAX_SIDE / Math.max(image.naturalWidth, image.naturalHeight));
  const w = Math.round(image.naturalWidth * fit);
  const h = Math.round(image.naturalHeight * fit);
  const make = (width: number, height: number) => {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    return canvas;
  };

  // Frosted body: mostly grey, pushed towards light, the colours only hinted.
  const body = make(w, h);
  const bodyCtx = body.getContext('2d');
  if (!bodyCtx) return null;
  bodyCtx.drawImage(image, 0, 0, w, h);
  const pixels = bodyCtx.getImageData(0, 0, w, h);
  const data = pixels.data;
  for (let i = 0; i < data.length; i += 4) {
    const grey = data[i]! * 0.299 + data[i + 1]! * 0.587 + data[i + 2]! * 0.114;
    for (let k = 0; k < 3; k++) {
      const mixed = data[i + k]! * 0.25 + grey * 0.75;
      data[i + k] = 120 + mixed * 0.47;
    }
  }
  bodyCtx.putImageData(pixels, 0, 0);

  // The same shape in white, for the edge highlight.
  const white = make(w, h);
  const whiteCtx = white.getContext('2d')!;
  whiteCtx.drawImage(body, 0, 0);
  whiteCtx.globalCompositeOperation = 'source-in';
  whiteCtx.fillStyle = '#fff';
  whiteCtx.fillRect(0, 0, w, h);

  const out = make(w + PAD * 2, h + PAD * 2);
  const ctx = out.getContext('2d')!;
  ctx.globalAlpha = 0.95;
  ctx.shadowColor = 'rgba(0, 0, 0, 0.8)';
  ctx.shadowBlur = 6;
  ctx.shadowOffsetY = 1.5;
  ctx.drawImage(body, PAD, PAD);
  ctx.drawImage(body, PAD, PAD);
  ctx.shadowColor = 'transparent';
  ctx.drawImage(white, PAD - 1.5, PAD - 1.5);
  ctx.drawImage(body, PAD, PAD);
  return out.toDataURL('image/png');
}
