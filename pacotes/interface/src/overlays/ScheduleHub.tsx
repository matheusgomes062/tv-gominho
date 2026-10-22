import type { Library } from '@tv-gominho/nucleo';
import { useState } from 'react';
import { Icon } from '../components/Icon';
import { KeyHints, Overlay } from '../components/Overlay';
import { resolveHubTarget, sameHubTarget, type HubTarget } from '../hub-model';

interface Props {
  library: Library;
  /** The row to focus when this screen opens (the one a closed sub-screen was opened from). */
  focus?: HubTarget | null;
  /** Opens "Criar uma programação", which builds a new channel. */
  onWizard(): void;
  /** Opens the "Desenhos que não passam" screen. */
  onBlocklist(): void;
  /** Opens the editor on the grade with this id (the grade file name). */
  onEdit(channelId: string): void;
  onBack(): void;
}

/**
 * Menu → Programação (and Configurações → Programação): the place to create a new channel ("Criar uma programação")
 * or to change one of the grades of the library. The automatic channel and the per-show channels are not files, so
 * they are not listed. File names and paths stay behind "Detalhes".
 */
export function ScheduleHub({ library, focus = null, onWizard, onEdit, onBlocklist, onBack }: Props) {
  const [details, setDetails] = useState(false);
  const target = resolveHubTarget(
    focus,
    library.schedules.map((schedule) => schedule.id),
  );
  const autofocus = (candidate: HubTarget) => (sameHubTarget(target, candidate) ? '' : undefined);

  return (
    <Overlay edge="left" label="Programação" onBack={onBack} className="wizard-overlay">
      <div className="wizard schedule-hub">
        <header className="panel-header">
          <Icon name="calendar" />
          <h1>Programação</h1>
          <button className="panel-close" onClick={onBack} aria-label="Fechar" title="Fechar" tabIndex={-1}>
            <Icon name="close" />
          </button>
        </header>

        <div className="wizard-body hub-body">
          <button data-nav data-autofocus={autofocus({ kind: 'wizard' })} data-hub="wizard" className="row wizard-row" onClick={onWizard}>
            <Icon name="plus" className="row-lead" />
            <span className="row-text">
              <span className="row-label">Criar uma programação</span>
              <span className="row-meta">Um assistente em poucos passos: horários, dias e programas.</span>
            </span>
            <Icon name="chevronRight" className="selector-arrow" />
          </button>

          <h2>Mudar uma programação</h2>
          {library.schedules.length === 0 ? (
            <p className="panel-note">Ainda não há programações criadas. Crie uma com “Criar uma programação” e ela aparece aqui para ser mudada.</p>
          ) : (
            <div className="wizard-list" role="list" aria-label="Programações para mudar">
              {library.schedules.map((schedule) => (
                <button
                  key={schedule.id}
                  data-nav
                  data-autofocus={autofocus({ kind: 'edit', id: schedule.id })}
                  data-hub-edit={schedule.id}
                  role="listitem"
                  className="row wizard-row"
                  onClick={() => onEdit(schedule.id)}
                >
                  <Icon name="clock" className="row-lead" />
                  <span className="row-text">
                    <span className="row-label">{schedule.name}</span>
                    <span className="row-meta">
                      {schedule.blocks.length} {schedule.blocks.length === 1 ? 'horário' : 'horários'}
                    </span>
                  </span>
                  <span className="hub-edit">Mudar</span>
                </button>
              ))}
            </div>
          )}

          <button data-nav data-autofocus={autofocus({ kind: 'blocklist' })} data-hub="blocklist" className="row wizard-row" onClick={onBlocklist}>
            <Icon name="close" className="row-lead" />
            <span className="row-text">
              <span className="row-label">Desenhos que não passam</span>
              <span className="row-meta">Programas e episódios que nenhuma programação escolhe sozinha.</span>
            </span>
            <Icon name="chevronRight" className="selector-arrow" />
          </button>

          <button data-nav data-hub-details className="action-tile small" aria-expanded={details} onClick={() => setDetails((open) => !open)}>
            <Icon name="info" className="action-icon" />
            <span>{details ? 'Esconder os detalhes' : 'Detalhes'}</span>
          </button>
          {details && (
            <div className="panel-note" data-details>
              <p>
                Cada programação é um arquivo na pasta <code>grades/</code> da biblioteca. A programação automática e as de cada programa não têm arquivo, então não são mudadas aqui.
              </p>
              {library.schedules.length > 0 && (
                <ul>
                  {library.schedules.map((schedule) => (
                    <li key={schedule.id}>
                      {schedule.name}: <code>{schedule.path}</code>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>

        <KeyHints
          hints={[
            ['↑ ↓', 'escolher'],
            ['OK', 'abrir'],
            ['Voltar', 'fechar'],
          ]}
        />
      </div>
    </Overlay>
  );
}
