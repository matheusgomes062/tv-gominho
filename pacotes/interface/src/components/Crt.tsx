import type { AspectMode, Settings } from '@tv-chuvisco/nucleo';
import { useEffect, useRef, useState, type CSSProperties, type RefObject } from 'react';
import { createCrtRenderer, type CrtRenderer, type CrtView } from './crt-renderer';

interface Props {
  /** The (hidden) <video> that supplies the picture; it keeps decoding and playing the audio. */
  video: RefObject<HTMLVideoElement | null>;
  settings: Settings['crt'];
  aspect: AspectMode;
  /** What the tube shows right now: the picture, channel-change snow, or black. */
  view: CrtView;
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
export function Crt({ video, settings, aspect, view, onActive }: Props) {
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
    return () => {
      created.destroy();
      renderer.current = null;
      canvas.remove();
      onActiveRef.current(false);
    };
  }, [video]);

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
