import type { Show } from '@tv-chuvisco/nucleo';
import { useEffect, useRef, useState } from 'react';
import { Crt } from '../components/Crt';
import { useFlash } from '../components/useFlash';
import { BACK_KEYS } from '../nav';
import { aspectClass, useSettings } from '../settings';
import type { BrowserLibrary } from '../sources/types';

interface Props {
  source: BrowserLibrary;
  show: Show;
  index: number;
  onIndex(index: number): void;
  onBack(): void;
}

/** On-demand player for Library mode: plays the episode, then the next one. */
export function Player({ source, show, index, onIndex, onBack }: Props) {
  const video = useRef<HTMLVideoElement>(null);
  const { settings } = useSettings();
  const [error, setError] = useState(false);
  // While the CRT canvas draws, the <video> is invisible, so its native controls are replaced by our own bar.
  const [crtActive, setCrtActive] = useState(false);
  const [paused, setPaused] = useState(true);
  const [clock, setClock] = useState({ time: 0, duration: 0 });
  const [title, showTitle] = useFlash(4000, true);
  const episode = show.episodes[index]!;

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
      if (!element) return;
      if (BACK_KEYS.has(event.key)) onBack();
      else if (event.key === 'Enter' || event.key === ' ' || event.key === 'MediaPlayPause') {
        if (element.paused) void element.play();
        else element.pause();
        showTitle();
      } else if (event.key === 'ArrowLeft') element.currentTime = Math.max(0, element.currentTime - 10);
      else if (event.key === 'ArrowRight') element.currentTime += 10;
      else if ((event.key === 'ArrowDown' || event.key === 'MediaTrackNext') && index + 1 < show.episodes.length) onIndex(index + 1);
      else if ((event.key === 'ArrowUp' || event.key === 'MediaTrackPrevious') && index > 0) onIndex(index - 1);
      else return;
      event.preventDefault();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [index, show.episodes.length, onBack, onIndex, showTitle]);

  return (
    <main className={`player ${aspectClass(settings.aspect)}`} onMouseMove={showTitle}>
      <div className="tv-screen">
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
            onClick={(event) => {
              const element = video.current;
              if (!element || !clock.duration) return;
              const box = event.currentTarget.getBoundingClientRect();
              element.currentTime = clock.duration * Math.min(1, Math.max(0, (event.clientX - box.left) / box.width));
            }}
          >
            <div className="player-progress-fill" style={{ width: `${clock.duration ? (clock.time / clock.duration) * 100 : 0}%` }} />
          </div>
          <span>
            {paused ? '❚❚' : '▶'} {formatTime(clock.time)} / {formatTime(clock.duration)}
          </span>
          <span className="player-hint">OK: pausar · ← → : 10 s · ↑ ↓ : episódio · Voltar: sair</span>
        </div>
      )}
      {(title || error) && (
        <div className="player-title">
          <button className="button" onClick={onBack}>
            ← Voltar
          </button>
          <div>
            <strong>{show.title}</strong>
            <span>{episode.title}</span>
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
