import type { Library, Show } from '@tv-chuvisco/nucleo';
import { useEffect } from 'react';
import { useFileUrl } from '../components/useFileUrl';
import { focusFirst, useSpatialNav } from '../nav';
import type { BrowserLibrary } from '../sources/types';

interface Props {
  source: BrowserLibrary;
  library: Library;
  focusShow?: string;
  onOpen(show: Show): void;
  onTv(): void;
}

export function LibraryMode({ source, library, focusShow, onOpen, onTv }: Props) {
  useSpatialNav(onTv);
  useEffect(() => {
    const target = focusShow && document.querySelector<HTMLElement>(`[data-show="${CSS.escape(focusShow)}"]`);
    if (target) target.focus();
    else focusFirst();
  }, [focusShow]);

  return (
    <main className="page">
      <header className="page-header">
        <button data-nav className="button" onClick={onTv}>
          📺 TV
        </button>
        <h1>Biblioteca</h1>
      </header>
      <div className="show-grid">
        {library.shows.map((show) => (
          <ShowCard key={show.id} source={source} show={show} onOpen={onOpen} />
        ))}
      </div>
    </main>
  );
}

function ShowCard({ source, show, onOpen }: { source: BrowserLibrary; show: Show; onOpen(show: Show): void }) {
  const poster = useFileUrl(source, show.poster);
  return (
    <button data-nav data-show={show.id} className="show-card" onClick={() => onOpen(show)}>
      {poster ? (
        <img src={poster} alt="" />
      ) : (
        <span className="show-card-placeholder">{show.title}</span>
      )}
      <span className="show-card-title">{show.title}</span>
    </button>
  );
}
