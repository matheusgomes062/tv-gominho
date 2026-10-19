import type { Schedule } from '@tv-gominho/nucleo';
import { Icon, type IconName } from '../components/Icon';
import { KeyHints, Overlay } from '../components/Overlay';

interface Props {
  channels: Schedule[];
  channel: number;
  warningCount: number;
  libraryName: string;
  onWatch(channel: number): void;
  onLibrary(): void;
  onWarnings(): void;
  onQuick(): void;
  onSettings(): void;
  onChangeFolder(): void;
  /** Closes the menu and goes back to the picture. */
  onBack(): void;
}

/**
 * The main menu: a sheet along the bottom of the live picture with the channels as cards, and below
 * them the other places to go. The TV keeps playing behind it.
 */
export function Menu({ channels, channel, warningCount, libraryName, onWatch, onLibrary, onWarnings, onQuick, onSettings, onChangeFolder, onBack }: Props) {
  const actions: Array<{ id: string; icon: IconName; label: string; badge?: number; run(): void }> = [
    { id: 'library', icon: 'book', label: 'Biblioteca', run: onLibrary },
    { id: 'quick', icon: 'settings', label: 'Ajustes rápidos', run: onQuick },
    { id: 'settings', icon: 'palette', label: 'Configurações', run: onSettings },
    { id: 'warnings', icon: 'alert', label: 'Avisos', badge: warningCount, run: onWarnings },
    { id: 'folder', icon: 'folder', label: 'Trocar pasta', run: onChangeFolder },
  ];

  return (
    <Overlay edge="bottom" label="Menu" onBack={onBack} className="menu-overlay">
      <header className="sheet-header">
        <h1 className="logo small">
          TV <span>Gominho</span>
        </h1>
        <span className="sheet-library">Pasta: {libraryName}</span>
      </header>

      <h2 className="sheet-title">Canais</h2>
      <div className="menu-channels" role="list">
        {channels.map((schedule, i) => (
          <button
            key={schedule.id}
            data-nav
            data-autofocus={i === channel ? '' : undefined}
            data-channel={i}
            role="listitem"
            className={`channel-card ${i === channel ? 'current' : ''}`}
            aria-current={i === channel ? 'true' : undefined}
            onClick={() => onWatch(i)}
          >
            <span className="channel-number">CH {String(i + 1).padStart(2, '0')}</span>
            <span className="channel-name">{schedule.name}</span>
            {i === channel && <span className="channel-live">no ar</span>}
          </button>
        ))}
      </div>

      <div className="menu-actions">
        {actions.map((action) => (
          <button key={action.id} data-nav data-action={action.id} className="action-tile" onClick={action.run}>
            <Icon name={action.icon} className="action-icon" />
            <span>{action.label}</span>
            {action.badge !== undefined && action.badge > 0 && <span className="badge">{action.badge}</span>}
          </button>
        ))}
      </div>

      <KeyHints
        hints={[
          ['← →', 'canais'],
          ['OK', 'escolher'],
          ['Voltar', 'fechar o menu'],
        ]}
      />
    </Overlay>
  );
}
