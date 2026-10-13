import type { Schedule } from '@tv-chuvisco/nucleo';
import { useEffect } from 'react';
import { focusFirst, useSpatialNav } from '../nav';

interface Props {
  channels: Schedule[];
  channel: number;
  warningCount: number;
  libraryName: string;
  onWatch(channel: number): void;
  onLibrary(): void;
  onWarnings(): void;
  onChangeFolder(): void;
}

export function Menu({ channels, channel, warningCount, libraryName, onWatch, onLibrary, onWarnings, onChangeFolder }: Props) {
  useSpatialNav(() => onWatch(channel));
  useEffect(() => focusFirst(), []);

  return (
    <main className="page menu">
      <h1 className="logo small">
        TV <span>Chuvisco</span>
      </h1>

      <section>
        <h2>Canais</h2>
        <div className="menu-grid">
          {channels.map((schedule, i) => (
            <button
              key={schedule.id}
              data-nav
              className={`button channel ${i === channel ? 'primary' : ''}`}
              onClick={() => onWatch(i)}
            >
              <span className="channel-number">CH {String(i + 1).padStart(2, '0')}</span>
              <span>{schedule.name}</span>
            </button>
          ))}
        </div>
      </section>

      <section>
        <h2>Mais</h2>
        <div className="menu-grid">
          <button data-nav className="button" onClick={onLibrary}>
            Biblioteca
          </button>
          <button data-nav className="button" onClick={onWarnings}>
            Avisos ({warningCount})
          </button>
          <button data-nav className="button" onClick={onChangeFolder}>
            Trocar pasta
          </button>
        </div>
        <p className="muted">Pasta atual: {libraryName}</p>
      </section>

      <p className="muted keys">
        Na TV: ↑ ↓ trocam de canal · OK mostra o que está passando · Esc abre este menu · clique duplo: tela cheia
      </p>
    </main>
  );
}
