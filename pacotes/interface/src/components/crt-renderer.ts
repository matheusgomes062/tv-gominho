// Raw WebGL CRT renderer: draws a <video> (or analog snow, or a black tube) through a
// "worn tube TV" fragment shader. No dependencies. Used by components/Crt.tsx.

export type CrtIntensity = 'soft' | 'medium' | 'strong';
/** What the tube shows: the video picture, channel-change snow, or nothing (black). */
export type CrtView = 'picture' | 'static' | 'black';

export interface CrtParams {
  intensity: CrtIntensity;
  /** Screen curvature, 0 (flat) to 100. */
  curvature: number;
  scanlines: boolean;
  view: CrtView;
  /** 'contain' keeps the video's aspect ratio (letterbox); 'fill' stretches it over the tube. */
  fit: 'contain' | 'fill';
  /** Multiplier for the internal resolution (1 = native, capped by MAX_PIXELS). Lower on slow boxes. */
  resolution: number;
}

export interface CrtRenderer {
  setParams(params: CrtParams): void;
  /** Call when the canvas' CSS size may have changed. */
  resize(): void;
  /** The drawing-buffer size in pixels (applies a pending resize first); the OSD canvas should match it. */
  size(): { width: number; height: number };
  /**
   * The on-screen display layer (components/osd-painter.ts), drawn inside the tube so it gets every CRT effect.
   * The canvas is uploaded on the next draw after each call (never per frame); null removes the layer.
   */
  setOsd(layer: HTMLCanvasElement | null): void;
  destroy(): void;
}

interface Preset {
  /** Scanline depth. */
  scan: number;
  /** Aperture-grille (RGB stripes) strength. */
  mask: number;
  vignette: number;
  /** Chromatic aberration (convergence error), in tube widths. */
  aberr: number;
  /** Glow around bright areas. */
  bloom: number;
  /** Per-pixel grain. */
  noise: number;
  /** Brightness flicker and the slow hum bar. */
  flicker: number;
  /** Horizontal line wobble. */
  jitter: number;
  /** Occasional tracking glitch band. */
  glitch: number;
  /** Glass reflection and lifted blacks. */
  glass: number;
}

const PRESETS: Record<CrtIntensity, Preset> = {
  soft: { scan: 0.28, mask: 0.07, vignette: 0.25, aberr: 0.0004, bloom: 0.3, noise: 0.012, flicker: 0.006, jitter: 0.0002, glitch: 0, glass: 0.5 },
  medium: { scan: 0.52, mask: 0.13, vignette: 0.4, aberr: 0.0007, bloom: 0.42, noise: 0.025, flicker: 0.014, jitter: 0.0007, glitch: 0.12, glass: 0.8 },
  strong: { scan: 0.82, mask: 0.22, vignette: 0.62, aberr: 0.0016, bloom: 0.6, noise: 0.05, flicker: 0.03, jitter: 0.002, glitch: 1, glass: 1.1 },
};

/** Barrel distortion at curvature 100 (50 gives 0.075, the old fixed 'medium' look). */
const MAX_CURV = 0.15;

/** Never render more pixels than this (a 960x720 tube at 1.5x DPR is 1.55M; this keeps Pi-class GPUs happy). */
const MAX_PIXELS = 1_300_000;
const MAX_DPR = 1.5;
/**
 * Adaptive quality: every CHECK_MS of playback, if the video dropped more than
 * DROP_LIMIT of its frames, the tube renders at the next smaller scale. It never
 * goes back up while the page is open, so it can't oscillate. Slow GPUs (Raspberry
 * Pi, TV boxes) settle on a scale they keep up with, without a setting.
 */
const AUTO_SCALES = [1, 0.75, 0.5];
const CHECK_MS = 3000;
const DROP_LIMIT = 0.05;
/** Min ms between renders when nothing but the CRT's own animation changes. */
const GAP_STATIC = 30;
const GAP_IDLE = 60;
/** Safety net when playing and requestVideoFrameCallback is not available. */
const GAP_PLAYING_NO_RVFC = 30;
/** Seconds to fade snow in/out when the view changes (a tube never cuts perfectly clean). */
const FADE_IN = 0.06;
const FADE_OUT = 0.22;

const VERTEX = `
attribute vec2 aPos;
varying vec2 vUv;
void main() {
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

const FRAGMENT = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
varying vec2 vUv;
uniform sampler2D uTex;
uniform sampler2D uOsd;   // the OSD layer, premultiplied RGBA, whole tube
uniform float uOsdOn;     // 0 when there is no OSD layer: skips the extra texture reads
uniform vec2 uFit;      // size of the video rectangle inside the tube (0..1 each)
uniform vec2 uRes;      // canvas size in pixels
uniform float uAspect;  // canvas width / height
uniform float uLines;   // visible scanlines
uniform float uTime;
uniform float uSeed;    // random per rendered frame
uniform float uPic;     // 0..1 amount of video
uniform float uStatic;  // 0..1 amount of snow
uniform float uCurv;
uniform float uScan;
uniform float uMask;
uniform float uVig;
uniform float uAberr;
uniform float uBloom;
uniform float uNoise;
uniform float uFlicker;
uniform float uJitter;
uniform float uGlitch;
uniform float uGlass;

// How much of the convergence error the OSD gets (the picture gets all of it).
#define OSD_ABERR 0.4

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

// Analog snow: cells a bit wider than tall, a little horizontal smear and per-line gain.
vec3 snow(vec2 c) {
  vec2 cells = vec2(uLines * uAspect * 0.62, uLines);
  vec2 cell = floor(c * cells);
  float n = hash12(cell + uSeed);
  float row = hash12(vec2(cell.y, uSeed * 1.37));
  float chunk = hash12(vec2(floor(cell.x * 0.25), cell.y) + uSeed * 2.11);
  float v = mix(n, chunk, 0.3) * (0.78 + 0.44 * row);
  float bar = 0.8 + 0.2 * sin(6.2832 * (c.y - uTime * 0.21));
  v = clamp((v - 0.5) * 1.35 + 0.5, 0.0, 1.0) * bar * 0.92;
  return vec3(v) * vec3(0.96, 1.0, 1.05);
}

// What the electron guns paint at tube position c (0..1, y up), before any tube effects.
vec3 scene(vec2 c, vec2 oc) {
  vec3 col = vec3(0.0);
  if (uPic > 0.001) {
    vec2 t = (c - 0.5) / uFit + 0.5;
    if (t.x >= 0.0 && t.x <= 1.0 && t.y >= 0.0 && t.y <= 1.0) {
      col = texture2D(uTex, vec2(t.x, 1.0 - t.y)).rgb * uPic;
    }
  }
  if (uStatic > 0.001) col = mix(col, snow(c), uStatic);
  // The on-screen display is painted by the same guns, over picture, snow and black alike (premultiplied alpha).
  // oc is where the OSD is read: the same spot, or a bit less convergence-shifted so small type stays readable.
  if (uOsdOn > 0.5 && oc.x >= 0.0 && oc.x <= 1.0 && oc.y >= 0.0 && oc.y <= 1.0) {
    vec4 o = texture2D(uOsd, vec2(oc.x, 1.0 - oc.y));
    col = col * (1.0 - o.a) + o.rgb;
  }
  return col;
}

void main() {
  vec2 p = vUv * 2.0 - 1.0;
  // Barrel distortion: edge midpoints stay put, corners bulge out of the tube.
  vec2 q = p * (1.0 + uCurv * vec2(p.y * p.y, p.x * p.x));
  vec2 c = q * 0.5 + 0.5;

  // Horizontal wobble, plus an occasional tracking band on worn tubes.
  float line = floor(c.y * uLines);
  float frameStep = floor(uTime * 25.0);
  float wob = sin(c.y * 22.0 + uTime * 2.1) * 0.5 + sin(c.y * 57.0 - uTime * 3.7) * 0.25
            + (hash12(vec2(line, frameStep)) - 0.5) * 0.5;
  float shift = wob * uJitter;
  float gate = step(fract(uTime / 9.0), 0.16);
  float band = smoothstep(0.05, 0.0, abs(c.y - fract(uTime * 0.37)));
  shift += uGlitch * gate * band * (hash12(vec2(line, frameStep)) - 0.35) * 0.03;
  vec2 s = vec2(c.x + shift, c.y);

  // Convergence error: red and blue drift apart toward the edges.
  float ab = uAberr * (1.0 + 2.5 * dot(p, p));
  vec3 col = vec3(scene(s + vec2(ab, 0.0), s + vec2(ab * OSD_ABERR, 0.0)).r, scene(s, s).g, scene(s - vec2(ab, 0.0), s - vec2(ab * OSD_ABERR, 0.0)).b);

  // Cheap bloom: four diagonal taps around the pixel, only the bright part is added back.
  vec2 r = vec2(0.0045, 0.0045 * uAspect);
  vec2 r2 = vec2(r.x, -r.y);
  vec3 bl = (scene(s + r, s + r) + scene(s - r, s - r) + scene(s + r2, s + r2) + scene(s - r2, s - r2)) * 0.25;
  col += uBloom * max(bl - col, 0.0);

  col *= col; // to linear light for the beam math
  float lum = dot(col, vec3(0.299, 0.587, 0.114));

  // Scanlines: a gaussian beam per line, wider when the pixel is bright.
  float ph = fract(c.y * uLines) - 0.5;
  float sigma = mix(0.16, 0.3, clamp(sqrt(lum), 0.0, 1.0));
  float beam = exp(-ph * ph / (2.0 * sigma * sigma));
  col *= mix(1.0, beam, uScan) * (1.0 + uScan * 0.3);

  // Aperture grille: RGB stripes, 3 canvas pixels per triad.
  vec3 stripe = 0.5 + 0.5 * cos(6.2832 * (gl_FragCoord.x / 3.0 + vec3(0.0, -0.3333, 0.3333)));
  col *= mix(vec3(1.0), stripe * 1.9, uMask);

  col = sqrt(max(col, 0.0));

  // Lifted blacks + faint glass reflection (top-left).
  vec2 g = (p - vec2(-0.5, 0.55)) * vec2(1.0, 1.5);
  col += uGlass * (0.012 + 0.05 * exp(-dot(g, g) * 3.0)) * (1.0 - 0.6 * lum);

  // Flicker, slow hum bar, grain.
  float flick = 1.0 + uFlicker * (sin(uTime * 61.0) * 0.4 + (hash12(vec2(uSeed, 7.0)) - 0.5) * 1.2);
  flick += uFlicker * 1.4 * sin(6.2832 * (c.y - uTime * 0.08));
  col *= flick;
  col += (hash12(gl_FragCoord.xy * 0.5 + uSeed * 13.0) - 0.5) * uNoise;

  // Vignette.
  float vig = smoothstep(1.55, 0.25, length(p * vec2(0.92, 1.0)));
  col *= mix(1.0, vig, uVig);

  // Outside the tube (and its rounded corners) is the black bezel.
  float aa = 3.0 / min(uRes.x, uRes.y);
  vec2 e = 1.0 - abs(q);
  float inside = smoothstep(0.0, aa * 2.0, min(e.x, e.y));
  if (uCurv > 0.0) {
    float rad = uCurv * 1.5; // corner radius grows with the bulge
    vec2 dd = abs(p) - (1.0 - rad);
    float d = length(max(dd, 0.0)) - rad;
    inside *= 1.0 - smoothstep(-aa, aa, d);
  }
  gl_FragColor = vec4(clamp(col, 0.0, 1.0) * inside, 1.0);
}`;

/** requestVideoFrameCallback is missing in older engines (and in some typings). */
interface FrameCallbacks {
  requestVideoFrameCallback?: (cb: () => void) => number;
  cancelVideoFrameCallback?: (id: number) => void;
}

function compile(gl: WebGLRenderingContext, type: number, source: string): WebGLShader | null {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    console.warn('CRT shader failed to compile:', gl.getShaderInfoLog(shader));
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

/** Returns null when WebGL is missing or the shader does not compile: the caller falls back to the plain video. */
export function createCrtRenderer(canvas: HTMLCanvasElement, videoElement: HTMLVideoElement, onState?: (working: boolean) => void): CrtRenderer | null {
  const video = videoElement;
  const callbacks = videoElement as unknown as FrameCallbacks;
  const gl = canvas.getContext('webgl', {
    alpha: false,
    antialias: false,
    depth: false,
    stencil: false,
    powerPreference: 'low-power',
    preserveDrawingBuffer: false,
  });
  if (!gl) return null;

  let program: WebGLProgram | null = null;
  let texture: WebGLTexture | null = null;
  let buffer: WebGLBuffer | null = null;
  const uniforms: Record<string, WebGLUniformLocation | null> = {};
  let texW = 0;
  let texH = 0;
  /** True once the texture holds a frame of the current source. */
  let textureValid = false;
  /** A new video frame is waiting to be uploaded. */
  let dirty = true;
  let lastTime = -1;
  /** The OSD layer canvas, its texture, and whether the texture is out of date. */
  let osdLayer: HTMLCanvasElement | null = null;
  let osdTexture: WebGLTexture | null = null;
  let osdDirty = false;
  let osdValid = false;

  let params: CrtParams = { intensity: 'medium', curvature: 50, scanlines: true, view: 'picture', fit: 'contain', resolution: 1 };
  let pic = 0;
  let snow = 0;
  let lastRender = 0;
  let lastNow = 0;
  let frames = 0;
  let uploads = 0;
  let rafId = 0;
  let rvfcId = 0;
  let lost = false;
  let destroyed = false;
  let needResize = true;
  let autoStep = 0;
  let lastCheck = 0;
  let lastQuality = { dropped: 0, total: 0 };

  /** Steps the internal resolution down when the video can't keep up (see AUTO_SCALES). */
  function checkQuality(now: number) {
    if (now - lastCheck < CHECK_MS || !video.getVideoPlaybackQuality) return;
    lastCheck = now;
    const quality = video.getVideoPlaybackQuality();
    const dropped = quality.droppedVideoFrames - lastQuality.dropped;
    const total = quality.totalVideoFrames - lastQuality.total;
    lastQuality = { dropped: quality.droppedVideoFrames, total: quality.totalVideoFrames };
    // Counters restart with each new file: a negative delta is a new video, not a measurement.
    if (total < 30 || dropped < 0) return;
    if (dropped / total > DROP_LIMIT && autoStep < AUTO_SCALES.length - 1) {
      autoStep++;
      needResize = true;
      canvas.dataset.autoScale = String(AUTO_SCALES[autoStep]);
    }
  }

  function init(): boolean {
    const vs = compile(gl!, gl!.VERTEX_SHADER, VERTEX);
    const fs = compile(gl!, gl!.FRAGMENT_SHADER, FRAGMENT);
    if (!vs || !fs) return false;
    program = gl!.createProgram();
    gl!.attachShader(program, vs);
    gl!.attachShader(program, fs);
    gl!.linkProgram(program);
    if (!gl!.getProgramParameter(program, gl!.LINK_STATUS)) {
      console.warn('CRT program failed to link:', gl!.getProgramInfoLog(program));
      return false;
    }
    gl!.useProgram(program);
    for (const name of [
      'uTex', 'uOsd', 'uOsdOn', 'uFit', 'uRes', 'uAspect', 'uLines', 'uTime', 'uSeed', 'uPic', 'uStatic', 'uCurv', 'uScan', 'uMask',
      'uVig', 'uAberr', 'uBloom', 'uNoise', 'uFlicker', 'uJitter', 'uGlitch', 'uGlass',
    ]) {
      uniforms[name] = gl!.getUniformLocation(program, name);
    }
    buffer = gl!.createBuffer();
    gl!.bindBuffer(gl!.ARRAY_BUFFER, buffer);
    gl!.bufferData(gl!.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl!.STATIC_DRAW);
    const position = gl!.getAttribLocation(program, 'aPos');
    gl!.enableVertexAttribArray(position);
    gl!.vertexAttribPointer(position, 2, gl!.FLOAT, false, 0, 0);

    texture = gl!.createTexture();
    gl!.bindTexture(gl!.TEXTURE_2D, texture);
    gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_WRAP_S, gl!.CLAMP_TO_EDGE);
    gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_WRAP_T, gl!.CLAMP_TO_EDGE);
    gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_MIN_FILTER, gl!.LINEAR);
    gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_MAG_FILTER, gl!.LINEAR);
    gl!.uniform1i(uniforms.uTex!, 0);

    // The OSD layer lives in texture unit 1.
    osdTexture = gl!.createTexture();
    gl!.activeTexture(gl!.TEXTURE1);
    gl!.bindTexture(gl!.TEXTURE_2D, osdTexture);
    gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_WRAP_S, gl!.CLAMP_TO_EDGE);
    gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_WRAP_T, gl!.CLAMP_TO_EDGE);
    gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_MIN_FILTER, gl!.LINEAR);
    gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_MAG_FILTER, gl!.LINEAR);
    gl!.uniform1i(uniforms.uOsd!, 1);
    gl!.activeTexture(gl!.TEXTURE0);
    osdValid = false;
    osdDirty = osdLayer !== null; // after a lost context, upload the layer again

    texW = texH = 0;
    textureValid = false;
    dirty = true;
    return true;
  }

  function applySize() {
    needResize = false;
    const cssW = canvas.clientWidth;
    const cssH = canvas.clientHeight;
    if (cssW === 0 || cssH === 0) return;
    let scale = Math.min(window.devicePixelRatio || 1, MAX_DPR) * Math.max(0.25, params.resolution * AUTO_SCALES[autoStep]!);
    scale = Math.min(scale, Math.sqrt(MAX_PIXELS / (cssW * cssH)));
    const w = Math.max(2, Math.round(cssW * scale));
    const h = Math.max(2, Math.round(cssH * scale));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
  }

  function upload() {
    if (video.readyState < 2 || video.videoWidth === 0) return;
    try {
      gl!.bindTexture(gl!.TEXTURE_2D, texture);
      if (video.videoWidth === texW && video.videoHeight === texH) {
        gl!.texSubImage2D(gl!.TEXTURE_2D, 0, 0, 0, gl!.RGBA, gl!.UNSIGNED_BYTE, video);
      } else {
        gl!.texImage2D(gl!.TEXTURE_2D, 0, gl!.RGBA, gl!.RGBA, gl!.UNSIGNED_BYTE, video);
        texW = video.videoWidth;
        texH = video.videoHeight;
      }
      textureValid = true;
      uploads++;
    } catch {
      // Tainted or not-yet-decodable frame: keep what we had.
    }
  }

  /** Uploads the OSD canvas as premultiplied RGBA. Called only when the layer changed. */
  function uploadOsd() {
    osdDirty = false;
    if (!osdLayer || osdLayer.width === 0 || osdLayer.height === 0) {
      osdValid = false;
      return;
    }
    try {
      gl!.activeTexture(gl!.TEXTURE1);
      gl!.bindTexture(gl!.TEXTURE_2D, osdTexture);
      gl!.pixelStorei(gl!.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
      gl!.texImage2D(gl!.TEXTURE_2D, 0, gl!.RGBA, gl!.RGBA, gl!.UNSIGNED_BYTE, osdLayer);
      osdValid = true;
    } catch {
      osdValid = false;
    } finally {
      gl!.pixelStorei(gl!.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      gl!.activeTexture(gl!.TEXTURE0);
    }
  }

  function draw(now: number, fromVideo: boolean) {
    if (lost || destroyed || !program) return;
    if (needResize) applySize();
    if (osdDirty) uploadOsd();
    const dt = Math.min(0.25, Math.max(0, (now - lastNow) / 1000));
    lastNow = now;
    lastRender = now;

    // Upload only when a new frame exists (rVFC) or, without rVFC, when the playhead moved.
    if (fromVideo || dirty || (!callbacks.requestVideoFrameCallback && video.currentTime !== lastTime)) {
      lastTime = video.currentTime;
      dirty = false;
      upload();
    }

    // Fade snow and picture toward their targets.
    const wantPic = params.view === 'picture' && textureValid ? 1 : 0;
    const wantSnow = params.view === 'static' ? 1 : 0;
    pic = wantPic > pic ? Math.min(wantPic, pic + dt / FADE_IN) : Math.max(wantPic, pic - dt / FADE_IN);
    snow = wantSnow > snow ? Math.min(wantSnow, snow + dt / FADE_IN) : Math.max(wantSnow, snow - dt / FADE_OUT);

    const preset = PRESETS[params.intensity];
    const w = canvas.width;
    const h = canvas.height;
    const tubeAspect = w / h;
    let fitX = 1;
    let fitY = 1;
    if (params.fit === 'contain' && texW > 0 && texH > 0) {
      const videoAspect = texW / texH;
      if (videoAspect > tubeAspect) fitY = tubeAspect / videoAspect;
      else fitX = videoAspect / tubeAspect;
    }
    const lines = Math.max(120, Math.min(300, Math.floor(h / 3)));
    const u = uniforms;
    gl!.viewport(0, 0, w, h);
    gl!.uniform2f(u.uFit!, fitX, fitY);
    gl!.uniform2f(u.uRes!, w, h);
    gl!.uniform1f(u.uAspect!, tubeAspect);
    gl!.uniform1f(u.uLines!, lines);
    gl!.uniform1f(u.uTime!, (now / 1000) % 1000);
    gl!.uniform1f(u.uSeed!, Math.random() * 100);
    gl!.uniform1f(u.uOsdOn!, osdLayer && osdValid ? 1 : 0);
    gl!.uniform1f(u.uPic!, pic);
    gl!.uniform1f(u.uStatic!, snow);
    gl!.uniform1f(u.uCurv!, Math.min(1, Math.max(0, params.curvature / 100)) * MAX_CURV);
    gl!.uniform1f(u.uScan!, params.scanlines ? preset.scan : 0);
    gl!.uniform1f(u.uMask!, params.scanlines ? preset.mask : 0);
    gl!.uniform1f(u.uVig!, preset.vignette);
    gl!.uniform1f(u.uAberr!, preset.aberr);
    gl!.uniform1f(u.uBloom!, preset.bloom);
    gl!.uniform1f(u.uNoise!, preset.noise);
    gl!.uniform1f(u.uFlicker!, preset.flicker);
    gl!.uniform1f(u.uJitter!, preset.jitter);
    gl!.uniform1f(u.uGlitch!, preset.glitch);
    gl!.uniform1f(u.uGlass!, preset.glass);
    gl!.drawArrays(gl!.TRIANGLE_STRIP, 0, 4);

    frames++;
    if (frames % 10 === 0) {
      // Debug counters for the e2e frame-rate check; a dataset write every 10 frames costs nothing.
      canvas.dataset.frames = String(frames);
      canvas.dataset.uploads = String(uploads);
    }
  }

  function loop(now: number) {
    rafId = requestAnimationFrame(loop);
    const playing = params.view === 'picture' && !video.paused && !video.ended && video.readyState >= 2;
    if (playing) checkQuality(now);
    // Playing with rVFC: the video drives the rendering; this only keeps flicker alive if frames are rare.
    const gap = playing ? (callbacks.requestVideoFrameCallback ? 120 : GAP_PLAYING_NO_RVFC) : params.view === 'static' ? GAP_STATIC : GAP_IDLE;
    if (now - lastRender >= gap - 2) draw(now, false);
  }

  function armVideoCallback() {
    if (!callbacks.requestVideoFrameCallback || destroyed) return;
    rvfcId = callbacks.requestVideoFrameCallback(() => {
      if (destroyed) return;
      if (params.view === 'picture') draw(performance.now(), true);
      else dirty = true;
      armVideoCallback();
    });
  }

  const markDirty = () => (dirty = true);
  const invalidate = () => {
    textureValid = false;
    dirty = true;
  };
  const onContextLost = (event: Event) => {
    event.preventDefault(); // allow restoration
    lost = true;
    canvas.style.visibility = 'hidden'; // a lost canvas is opaque black: let the plain video show meanwhile
    onState?.(false);
  };
  const onContextRestored = () => {
    lost = false;
    if (init()) {
      canvas.style.visibility = '';
      onState?.(true);
    } else {
      destroyed = true;
    }
  };

  if (!init()) {
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return null;
  }
  canvas.addEventListener('webglcontextlost', onContextLost);
  canvas.addEventListener('webglcontextrestored', onContextRestored);
  video.addEventListener('loadeddata', markDirty);
  video.addEventListener('seeked', markDirty);
  video.addEventListener('playing', markDirty);
  video.addEventListener('emptied', invalidate);
  video.addEventListener('loadstart', invalidate);
  const observer = new ResizeObserver(() => (needResize = true));
  observer.observe(canvas);
  rafId = requestAnimationFrame(loop);
  armVideoCallback();

  return {
    setParams(next) {
      const resolutionChanged = next.resolution !== params.resolution;
      params = next;
      if (resolutionChanged) needResize = true;
    },
    resize() {
      needResize = true;
    },
    size() {
      if (needResize) applySize();
      return { width: canvas.width, height: canvas.height };
    },
    setOsd(layer) {
      osdLayer = layer;
      osdDirty = layer !== null;
      if (!layer) osdValid = false;
    },
    destroy() {
      destroyed = true;
      cancelAnimationFrame(rafId);
      if (rvfcId) callbacks.cancelVideoFrameCallback?.(rvfcId);
      observer.disconnect();
      canvas.removeEventListener('webglcontextlost', onContextLost);
      canvas.removeEventListener('webglcontextrestored', onContextRestored);
      video.removeEventListener('loadeddata', markDirty);
      video.removeEventListener('seeked', markDirty);
      video.removeEventListener('playing', markDirty);
      video.removeEventListener('emptied', invalidate);
      video.removeEventListener('loadstart', invalidate);
      if (!lost) {
        if (texture) gl.deleteTexture(texture);
        if (osdTexture) gl.deleteTexture(osdTexture);
        if (buffer) gl.deleteBuffer(buffer);
        if (program) gl.deleteProgram(program);
      }
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    },
  };
}
