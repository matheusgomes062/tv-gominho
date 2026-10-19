import type { Show } from '@tv-gominho/nucleo';
import { useEffect } from 'react';
import { useFileUrl } from '../components/useFileUrl';
import { focusFirst, useSpatialNav } from '../nav';
import type { BrowserLibrary } from '../sources/types';
import { Icon } from '../components/Icon';

interface Props {
  source: BrowserLibrary;
  show: Show;
  focusEpisode?: number;
  onPlay(index: number): void;
  onBack(): void;
}

export function ShowPage({ source, show, focusEpisode, onPlay, onBack }: Props) {
  const backdrop = useFileUrl(source, show.backdrop ?? show.poster);
  useSpatialNav(onBack);
  useEffect(() => {
    const target = focusEpisode !== undefined && document.querySelector<HTMLElement>(`[data-episode="${focusEpisode}"]`);
    if (target) target.focus();
    else focusFirst();
  }, [focusEpisode]);

  const details = [show.year, `${show.episodes.length} episódio${show.episodes.length === 1 ? '' : 's'}`, show.rating && (/^\d+$/.test(show.rating) ? `${show.rating} anos` : show.rating)]
    .filter(Boolean)
    .join(' · ');

  return (
    <main className="page show-page">
      {backdrop && <div className="show-backdrop" style={{ backgroundImage: `url("${backdrop}")` }} />}
      <header className="page-header">
        <button data-nav className="button" onClick={onBack}>
          <Icon name="back" /> Biblioteca
        </button>
      </header>
      <section className="show-info">
        <h1>{show.title}</h1>
        {show.originalTitle && <p className="muted">{show.originalTitle}</p>}
        <p className="show-details">{details}</p>
        {show.description && <p className="show-description">{show.description}</p>}
      </section>
      <ol className="episode-list">
        {show.episodes.map((episode, i) => {
          const newSeason = episode.season !== null && episode.season !== show.episodes[i - 1]?.season;
          return (
            <li key={episode.path}>
              {newSeason && <h2 className="season">{episode.season!.replace(/[-_]/g, ' ')}</h2>}
              <button data-nav data-episode={i} className="episode" onClick={() => onPlay(i)}>
                <span className="episode-number">{episode.number ?? i + 1}</span>
                <span className="episode-text">
                  <span className="episode-title">{episode.title}</span>
                  {episode.description && <span className="episode-description">{episode.description}</span>}
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </main>
  );
}
