import type { Show } from '@tv-chuvisco/nucleo';
import { useCallback, useEffect, useRef, useState, type PointerEvent } from 'react';
import { Crt } from '../components/Crt';
import { useFlash } from '../components/useFlash';
import { BACK_KEYS } from '../nav';
import { aspectClass, useSettings } from '../settings';
import type { BrowserLibrary } from '../sources/types';
import { Icon } from '../components/Icon';

interface Props {
  source: BrowserLibrary;
  show: Show;
  index: number;
  onIndex(index: number): void;
  /** A layer (quick settings…) is open over the picture: the player stays put and ignores the keys. */
  overlayOpen: boolean;
  onQuick(): void;
  onBack(): void;
}

/** On-demand player for Library mode: plays the episode, then the next one. */
export function Player({ source, show, index, onIndex, overlayOpen, onQuick, onBack }: Props) {
  const video = useRef<HTMLVideoElement>(null);
  const { settings } = useSettings();
  const [error, setError] = useState(false);
  // While the CRT canvas draws, the <video> is invisible, so its native controls are replaced by our own bar.
  const [crtActive, setCrtActive] = useState(false);
  const [paused, setPaused] = useState(true);
  const [clock, setClock] = useState({ time: 0, duration: 0 });
  const [title, showTitle] = useFlash(4000, true);
  const episode = show.episodes[index]!;

  const togglePlay = useCallback(() => {
    const element = video.current;
    if (!element) return;
    if (element.paused) void element.play();
    else element.pause();
    showTitle();
  }, [showTitle]);
  /** Seeks to the pointer's position along the progress bar (a click, or a drag with the button held). */
  const seekTo = (event: PointerEvent<HTMLElement>) => {
    const element = video.current;
    if (!element || !clock.duration) return;
    const box = event.currentTarget.getBoundingClientRect();
    element.currentTime = clock.duration * Math.min(1, Math.max(0, (event.clientX - box.left) / box.width));
    showTitle();
  };

  useEffect(() => {
    let cancelled = false;
    setError(false);
    showTitle();
    source.url(episode.path).then((url) => {
      const element = video.current;
      if (cancelled || !element) return;
      element.src = url;
      element.play().catch(() => undefined); // if blocked, the native controls still work
    });
    return () => {
      cancelled = true;
    };
  }, [source, episode.path, showTitle]);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const element = video.current;
      if (!element || overlayOpen || event.defaultPrevented) return;
      if (BACK_KEYS.has(event.key)) onBack();
      else if (event.key === 's' || event.key === 'S' || event.key === 'ContextMenu') onQuick();
      else if (event.key === 'Enter' || event.key === ' ' || event.key === 'MediaPlayPause') togglePlay();
      else if (event.key === 'ArrowLeft') element.currentTime = Math.max(0, element.currentTime - 10);
      else if (event.key === 'ArrowRight') element.currentTime += 10;
      else if ((event.key === 'ArrowDown' || event.key === 'MediaTrackNext') && index + 1 < show.episodes.length) onIndex(index + 1);
      else if ((event.key === 'ArrowUp' || event.key === 'MediaTrackPrevious') && index > 0) onIndex(index - 1);
      else return;
      event.preventDefault();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [index, show.episodes.length, overlayOpen, onBack, onQuick, onIndex, togglePlay]);

  return (
    <main className={`player ${aspectClass(settings.aspect)}`} onMouseMove={showTitle}>
      {/* While the CRT canvas hides the <video>, a click on the picture pauses/plays (the native controls do it otherwise). */}
      <div className="tv-screen" onClick={crtActive ? togglePlay : undefined}>
        <video
          ref={video}
          className={`player-video ${crtActive ? 'crt-hidden' : ''}`}
          controls={!crtActive}
          playsInline
          onPlay={() => setPaused(false)}
          onPause={() => setPaused(true)}
          onTimeUpdate={(event) => setClock({ time: event.currentTarget.currentTime, duration: event.currentTarget.duration || 0 })}
          onEnded={() => (index + 1 < show.episodes.length ? onIndex(index + 1) : onBack())}
          onError={() => setError(true)}
        />
        {settings.crt.enabled && (
          <Crt video={video} settings={settings.crt} aspect={settings.aspect} view="picture" onActive={setCrtActive} />
        )}
      </div>
      {crtActive && (title || paused) && (
        <div className="player-controls">
          <div
            className="player-progress"
            role="slider"
            aria-label="Posição"
            aria-valuemin={0}
            aria-valuemax={Math.round(clock.duration)}
            aria-valuenow={Math.round(clock.time)}
            onPointerDown={(event) => {
              event.currentTarget.setPointerCapture(event.pointerId);
              seekTo(event);
            }}
            onPointerMove={(event) => {
              if (event.currentTarget.hasPointerCapture(event.pointerId)) seekTo(event);
            }}
          >
            <div className="player-progress-fill" style={{ width: `${clock.duration ? (clock.time / clock.duration) * 100 : 0}%` }} />
          </div>
          <button
            className="player-play"
            data-player="toggle"
            onClick={togglePlay}
            onMouseDown={(event) => event.preventDefault()}
            aria-label={paused ? 'Tocar' : 'Pausar'}
            tabIndex={-1}
          >
            <Icon name={paused ? 'play' : 'pause'} />
          </button>
          <span>
            {formatTime(clock.time)} / {formatTime(clock.duration)}
          </span>
          <span className="player-hint">OK: pausar · ← → : 10 s · ↑ ↓ : episódio · S: ajustes · Voltar: sair</span>
        </div>
      )}
      {(title || error) && (
        <div className="player-title">
          <button className="button" onClick={onBack}>
            <Icon name="back" /> Voltar
          </button>
          <div>
            <strong>{show.title}</strong>
            <span>{episode.title}</span>
          </div>
          {/* Mouse/touch only: the buttons never take keyboard focus, so Enter/Space keep toggling playback. */}
          <div className="player-actions" onMouseDown={(event) => event.preventDefault()}>
            <button className="button" data-player="prev" onClick={() => onIndex(index - 1)} disabled={index === 0} aria-label="Episódio anterior" tabIndex={-1}>
              <Icon name="skipBack" />
            </button>
            <button className="button" data-player="next" onClick={() => onIndex(index + 1)} disabled={index + 1 >= show.episodes.length} aria-label="Próximo episódio" tabIndex={-1}>
              <Icon name="skipForward" />
            </button>
            <button className="button" data-player="quick" onClick={onQuick} tabIndex={-1}>
              <Icon name="settings" /> Ajustes
            </button>
          </div>
        </div>
      )}
      {error && (
        <p className="player-error" role="alert">
          Não foi possível tocar este arquivo. Ele precisa estar em MP4 (H.264 + AAC).
        </p>
      )}
    </main>
  );
}

function formatTime(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const m = Math.floor(total / 60);
  return `${m}:${String(total % 60).padStart(2, '0')}`;
}
