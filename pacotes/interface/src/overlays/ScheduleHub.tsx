import type { Library } from '@tv-gominho/nucleo';
import { Icon } from '../components/Icon';
import { KeyHints, Overlay } from '../components/Overlay';

interface Props {
  library: Library;
  /** Opens "Montar a semana", which builds a new channel. */
  onWizard(): void;
  /** Opens the "Não passar" screen. */
  onBlocklist(): void;
  /** Opens the editor on the grade with this id (the grade file name). */
  onEdit(channelId: string): void;
  onBack(): void;
}

/**
 * Menu → Programação: the place to build a new channel ("Montar a semana") or to edit one of the grades
 * of the library. The automatic channel and the per-show channels are not files, so they are not listed.
 */
export function ScheduleHub({ library, onWizard, onEdit, onBlocklist, onBack }: Props) {
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
          <h2>Um canal novo</h2>
          <button data-nav data-autofocus data-hub="wizard" className="row wizard-row" onClick={onWizard}>
            <Icon name="plus" className="row-lead" />
            <span className="row-text">
              <span className="row-label">Montar a semana</span>
              <span className="row-meta">Um assistente em poucos passos: horários, dias e programas.</span>
            </span>
            <Icon name="chevronRight" className="selector-arrow" />
          </button>

          <h2>Editar um canal</h2>
          {library.schedules.length === 0 ? (
            <p className="panel-note">
              A biblioteca ainda não tem grades em <code>grades/</code>. Monte um canal com “Montar a semana” e ele aparece aqui para ser editado.
            </p>
          ) : (
            <div className="wizard-list" role="list" aria-label="Canais para editar">
              {library.schedules.map((schedule) => (
                <button
                  key={schedule.id}
                  data-nav
                  data-hub-edit={schedule.id}
                  role="listitem"
                  className="row wizard-row"
                  onClick={() => onEdit(schedule.id)}
                >
                  <Icon name="clock" className="row-lead" />
                  <span className="row-text">
                    <span className="row-label">{schedule.name}</span>
                    <span className="row-meta">
                      {schedule.blocks.length} {schedule.blocks.length === 1 ? 'bloco' : 'blocos'} · <code>{schedule.path}</code>
                    </span>
                  </span>
                  <span className="hub-edit">Editar</span>
                </button>
              ))}
            </div>
          )}
          <p className="panel-note">O canal automático e os canais por programa não têm arquivo de grade, então não são editados aqui.</p>

          <h2>O que não passa</h2>
          <button data-nav data-hub="blocklist" className="row wizard-row" onClick={onBlocklist}>
            <Icon name="close" className="row-lead" />
            <span className="row-text">
              <span className="row-label">Não passar</span>
              <span className="row-meta">Programas e episódios que nenhum canal escolhe sozinho.</span>
            </span>
            <Icon name="chevronRight" className="selector-arrow" />
          </button>
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
