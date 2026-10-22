import type { AspectMode, Settings } from '@tv-gominho/nucleo';
import { useCallback, useEffect, useRef, useState, type CSSProperties, type RefObject } from 'react';
import { createCrtRenderer, type CrtRenderer, type CrtView } from './crt-renderer';
import { loadOsdFonts, OSD_FONTS, paintOsd, readOsdColors, type OsdFade, type OsdState } from './osd-painter';

/** The OSD fades in and out in this many steps, one every OSD_FADE_MS (a handful of texture uploads per fade). */
const OSD_FADE_STEPS = 3;
const OSD_FADE_MS = 50;

interface Props {
  /** The (hidden) <video> that supplies the picture; it keeps decoding and playing the audio. */
  video: RefObject<HTMLVideoElement | null>;
  settings: Settings['crt'];
  aspect: AspectMode;
  /** What the tube shows right now: the picture, channel-change snow, or black. */
  view: CrtView;
  /**
   * The TV's on-screen display (channel OSD, info box, clock, watermark). It is painted into the tube, so it gets curvature,
   * scanlines, glow and the rest of the CRT treatment. Null draws nothing.
   */
  osd?: OsdState | null;
  /**
   * Tells the parent whether the WebGL tube is really drawing, so it can hide its plain video (and its
   * own static/black layers). False while loading, when WebGL is missing, or after a failure.
   */
  onActive(active: boolean): void;
}

/**
 * The CRT tube: a WebGL canvas that fills `.tv-screen` and draws the video through a shader (curvature,
 * scanlines, shadow mask, glow, aberration, vignette, flicker, snow). Settings apply live.
 * If WebGL is unavailable it renders a CSS-only scanline/vignette overlay instead and reports inactive,
 * so the parent keeps showing the plain video.
 */
export function Crt({ video, settings, aspect, view, osd = null, onActive }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const renderer = useRef<CrtRenderer | null>(null);
  const [failed, setFailed] = useState(false);
  const onActiveRef = useRef(onActive);
  onActiveRef.current = onActive;

  const params = {
    intensity: settings.intensity,
    curvature: settings.curvature,
    scanlines: settings.scanlines,
    view,
    fit: aspect === 'stretch' ? ('fill' as const) : ('contain' as const),
    resolution: 1,
  };
  // Always the latest, so a freshly created renderer starts with the current settings.
  const latest = useRef(params);
  latest.current = params;

  // --- On-screen display: painted to an offscreen canvas, uploaded to the tube only when it changes. ---
  const osdState = useRef(osd);
  osdState.current = osd;
  const layer = useRef<{
    canvas: HTMLCanvasElement;
    fade: OsdFade;
    last: Pick<OsdState, 'channel' | 'info'>;
    timer: number | undefined;
    fonts: Set<string>;
  } | null>(null);

  const repaintOsd = useCallback(() => {
    const target = renderer.current;
    const host_ = host.current;
    const state = osdState.current;
    if (!target || !host_) return;
    layer.current ??= { canvas: document.createElement('canvas'), fade: { channel: 0, info: 0 }, last: { channel: null, info: null }, timer: undefined, fonts: new Set() };
    const l = layer.current;
    clearTimeout(l.timer);
    if (!state) {
      target.setOsd(null);
      return;
    }
    // The canvas cannot wait for a web font: load the skin's fonts first, then paint.
    if (!l.fonts.has(state.skin)) {
      const skin = state.skin;
      void loadOsdFonts(skin).then(() => {
        l.fonts.add(skin);
        // Debug hook for the e2e font check: which bundled fonts the painter waited for.
        if (host.current) host.current.dataset.osdFonts = [...new Set(Object.values(OSD_FONTS[skin]))].join('|');
        repaintOsd();
      });
      return;
    }
    // Fade the transient parts toward their targets (quantized: every step is a texture upload).
    const step = 1 / OSD_FADE_STEPS;
    const move = (value: number, on: boolean) => (on ? Math.min(1, value + step) : Math.max(0, value - step));
    l.fade = { channel: move(l.fade.channel, !!state.channel), info: move(l.fade.info, !!state.info) };
    if (state.channel) l.last.channel = state.channel;
    if (state.info) l.last.info = state.info;
    const painted: OsdState = { ...state, channel: state.channel ?? l.last.channel, info: state.info ?? l.last.info };
    const visible = !!painted.clock || !!painted.watermark || l.fade.channel > 0 || l.fade.info > 0;
    if (visible) {
      const { width: bufW, height: bufH } = target.size();
      const cssW = host_.clientWidth;
      const cssH = host_.clientHeight;
      if (cssW > 0 && cssH > 0) {
        if (l.canvas.width !== bufW || l.canvas.height !== bufH) {
          l.canvas.width = bufW;
          l.canvas.height = bufH;
        }
        paintOsd(l.canvas, painted, { width: cssW, height: cssH, scale: bufW / cssW, em: parseFloat(getComputedStyle(host_).fontSize) || 16, colors: readOsdColors(host_) }, l.fade);
        target.setOsd(l.canvas);
      }
    } else {
      target.setOsd(null);
    }
    const settled = l.fade.channel === (state.channel ? 1 : 0) && l.fade.info === (state.info ? 1 : 0);
    if (!settled) l.timer = window.setTimeout(repaintOsd, OSD_FADE_MS);
  }, []);

  useEffect(() => {
    const element = video.current;
    const container = host.current;
    if (!element || !container) return;
    // A fresh canvas per run: a lost WebGL context cannot be re-created on the same canvas (StrictMode, remounts).
    const canvas = document.createElement('canvas');
    canvas.className = 'crt-canvas';
    canvas.setAttribute('aria-hidden', 'true');
    container.appendChild(canvas);
    // WebGL context lost: show the plain video until the browser restores it.
    const created = createCrtRenderer(canvas, element, (working) => onActiveRef.current(working));
    if (!created) {
      canvas.remove();
      setFailed(true);
      onActiveRef.current(false);
      return;
    }
    created.setParams(latest.current);
    renderer.current = created;
    setFailed(false);
    onActiveRef.current(true);
    repaintOsd();
    // The OSD layer matches the drawing buffer: paint again when the tube changes size.
    const observer = new ResizeObserver(() => repaintOsd());
    observer.observe(container);
    return () => {
      observer.disconnect();
      if (layer.current) clearTimeout(layer.current.timer);
      created.destroy();
      renderer.current = null;
      canvas.remove();
      onActiveRef.current(false);
    };
  }, [video, repaintOsd]);

  // Repaint whenever the OSD state changes (the parent keeps it referentially stable between changes).
  useEffect(() => {
    repaintOsd();
  }, [osd, repaintOsd]);

  const { intensity, curvature, scanlines, view: currentView, fit, resolution } = params;
  useEffect(() => {
    renderer.current?.setParams({ intensity, curvature, scanlines, view: currentView, fit, resolution });
  }, [intensity, curvature, scanlines, currentView, fit, resolution]);

  if (failed) {
    return (
      <div
        className={`crt-fallback crt-fallback-${settings.intensity} ${settings.scanlines ? 'with-lines' : ''} ${settings.curvature > 0 ? 'with-curve' : ''}`}
        style={{ '--crt-curve': settings.curvature / 100 } as CSSProperties}
        aria-hidden="true"
      />
    );
  }
  return <div ref={host} className="crt" data-view={view} aria-hidden="true" />;
}
