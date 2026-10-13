import type { Show } from '@tv-chuvisco/nucleo';
import { useEffect, useRef, useState } from 'react';
import { useFlash } from '../components/useFlash';
import { BACK_KEYS } from '../nav';
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
  const [error, setError] = useState(false);
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
    <main className="player" onMouseMove={showTitle}>
      <video
        ref={video}
        className="player-video"
        controls
        playsInline
        onEnded={() => (index + 1 < show.episodes.length ? onIndex(index + 1) : onBack())}
        onError={() => setError(true)}
      />
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
