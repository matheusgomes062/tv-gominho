import type { Library } from '@tv-gominho/nucleo';
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import {
  airingOf,
  buildWeek,
  clearPick,
  episodeChoices,
  episodeLabel,
  setPick,
  shiftWeek,
  weekLabel,
  weekStartOf,
  type AgendaCell,
  type AgendaRow,
} from '../agenda-model';
import { Icon } from '../components/Icon';
import { useWeek } from '../components/useWeek';
import { WeekView, WeekWarnings } from '../components/WeekView';
import type { EditorState } from '../editor-model';
import type { Durations } from '../media';
import { longDayLabel, previewDates } from '../wizard-model';
import type { Airing } from '../week-model';

interface Props {
  state: EditorState;
  library: Library;
  durations: Durations;
  /** "YYYY-MM-DD": today. Earlier days are shown but not editable. */
  today: string;
  edit(change: (current: EditorState) => EditorState): void;
}

interface Open {
  itemKey: number;
  date: string;
  /** What the list is about: "Popeye, Qua 22/10 às 08:21". */
  title: string;
}

/**
 * The week of the channel in "Mudar uma programação": every day with what airs and at what time (the same engine and the
 * same component as the preview of the wizard), for the channel as it is in the editor right now, saved or not. Choosing
 * an episode lists the episodes of its show; picking one pins that day and the days after it go on from there.
 */
export function ChannelWeek({ state, library, durations, today, edit }: Props) {
  const [weekStart, setWeekStart] = useState(() => weekStartOf(today));
  const [open, setOpen] = useState<Open | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const thisWeek = weekStartOf(today);
  const dates = useMemo(() => previewDates(weekStart, 7), [weekStart]);
  const grade = useMemo(() => airingOf(state, library, today), [state, library, today]);
  const { week, reading } = useWeek(grade?.schedule, library, dates, durations, { today, itemKeyAt: grade?.itemKeyAt });
  // Which episodes can be picked in a cell, and which one plays now.
  const cells = useMemo(() => buildWeek(state, library, weekStart, today), [state, library, weekStart, today]);

  const chosen = (() => {
    if (!open) return null;
    const r = cells.rows.findIndex((row) => row.itemKey === open.itemKey);
    const c = cells.dates.indexOf(open.date);
    return r >= 0 && c >= 0 ? { row: cells.rows[r]!, cell: cells.cells[r]![c]! } : null;
  })();

  /** Back to the airing that opened the list. */
  const close = (target: Open | null) => {
    setOpen(null);
    if (!target) return;
    requestAnimationFrame(() => root.current?.querySelector<HTMLElement>(`[data-cell="${target.itemKey}|${target.date}"]`)?.focus());
  };

  const goTo = (next: string) => {
    setOpen(null);
    setWeekStart(next);
  };

  // The list is below the week: bring it into view and start on the episode that plays now.
  useEffect(() => {
    if (!open) return;
    const list = root.current?.querySelector<HTMLElement>('.agenda-chooser');
    list?.scrollIntoView({ block: 'nearest' });
    const start = list?.querySelector<HTMLElement>('[data-current]') ?? list?.querySelector<HTMLElement>('[data-choice]');
    start?.focus();
  }, [open]);

  const pick = (airing: Airing) => {
    if (airing.itemKey === undefined) return;
    setOpen({ itemKey: airing.itemKey, date: airing.date, title: `${airing.showTitle}, ${longDayLabel(airing.date)} às ${airing.time}` });
  };

  if (!grade) {
    return (
      <div className="agenda" ref={root}>
        <p className="panel-note" data-agenda-empty>
          Nada para mostrar ainda. Em “Ajustes avançados”, acrescente um desenho a um horário, com a quantidade certa, e escolha pelo menos um dia.
        </p>
      </div>
    );
  }

  return (
    <div className="agenda" ref={root}>
      <p className="panel-note">
        Cada linha é um dia, com o horário em que cada episódio começa (estimado pela duração dos vídeos). Escolha um episódio para fixar o que passa naquele dia: os dias seguintes continuam a partir dele. As mudanças valem quando você salva o canal.
      </p>

      <div className="agenda-nav" role="group" aria-label="Semana" data-nav-row="week">
        <button data-nav data-week="prev" className="action-tile small" onClick={() => goTo(shiftWeek(weekStart, -1))}>
          <Icon name="chevronLeft" className="action-icon" />
          <span>Anterior</span>
        </button>
        <strong className="agenda-week" aria-live="polite" data-week-label>
          {weekLabel(weekStart)}
        </strong>
        <button data-nav data-week="today" className="action-tile small" aria-disabled={weekStart === thisWeek || undefined} onClick={() => weekStart !== thisWeek && goTo(thisWeek)}>
          <Icon name="calendar" className="action-icon" />
          <span>Esta semana</span>
        </button>
        <button data-nav data-week="next" className="action-tile small" onClick={() => goTo(shiftWeek(weekStart, 1))}>
          <span>Próxima</span>
          <Icon name="chevronRight" className="action-icon" />
        </button>
      </div>

      {week && (
        <>
          <WeekView week={week} label={`Semana de ${weekLabel(weekStart)}`} onPick={pick} />
          <WeekWarnings week={week} />
          <p className="panel-note" data-note="estimate">
            {week.estimated
              ? 'Estimado: alguns vídeos ainda não tiveram a duração lida, então valem durações típicas e os horários são aproximados.'
              : reading
                ? 'Lendo a duração dos vídeos da semana… os horários podem mudar um pouco.'
                : 'Horários calculados com a duração real dos vídeos, já com os intervalos.'}
          </p>
        </>
      )}

      {open && chosen && (
        <Chooser
          library={library}
          row={chosen.row}
          cell={chosen.cell}
          title={open.title}
          onPick={(ref) => {
            edit((current) => setPick(current, chosen.row.itemKey, chosen.cell.date, ref));
            close(open);
          }}
          onReset={() => {
            edit((current) => clearPick(current, chosen.row.itemKey, chosen.cell.date));
            close(open);
          }}
          onCancel={() => close(open)}
        />
      )}
    </div>
  );
}

function Chooser({
  library,
  row,
  cell,
  title,
  onPick,
  onReset,
  onCancel,
}: {
  library: Library;
  row: AgendaRow;
  cell: AgendaCell;
  title: string;
  onPick(ref: string): void;
  onReset(): void;
  onCancel(): void;
}) {
  const choices = useMemo(() => episodeChoices(library, row, cell), [library, row, cell]);
  const pinned = cell.pick !== null;
  // Esc closes the list, not the whole editor.
  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === 'Escape' || event.key === 'Backspace' || event.key === 'BrowserBack' || event.key === 'GoBack') {
      event.preventDefault();
      event.stopPropagation();
      onCancel();
    }
  };
  return (
    <section className="agenda-chooser" aria-label={`Escolher o episódio: ${title}`} onKeyDown={onKeyDown} data-chooser>
      <header className="agenda-chooser-head">
        <h3>
          Escolher o episódio <span className="row-meta">{title}</span>
        </h3>
        <div className="agenda-chooser-actions">
          {pinned && (
            <button data-nav data-reset className="action-tile small" onClick={onReset}>
              <Icon name="restore" className="action-icon" />
              <span>Voltar ao dinâmico</span>
            </button>
          )}
          <button data-nav data-cancel className="action-tile small" onClick={onCancel}>
            <Icon name="close" className="action-icon" />
            <span>Cancelar</span>
          </button>
        </div>
      </header>
      {cell.more > 0 && (
        <p className="panel-note">Aqui passam {cell.more + 1} episódios seguidos: o que você escolher abre a sequência.</p>
      )}
      {choices.length === 0 ? (
        <p className="panel-note">Esse programa não tem episódios na biblioteca.</p>
      ) : (
        <ol className="agenda-choices">
          {choices.map((choice) => {
            const usable = choice.ref !== null;
            return (
              <li key={choice.index}>
                <button
                  data-nav
                  data-choice={choice.ref ?? ''}
                  data-current={choice.current ? '' : undefined}
                  className="agenda-choice"
                  aria-disabled={!usable || undefined}
                  aria-current={choice.current || undefined}
                  title={usable ? undefined : 'Este episódio não tem número no nome do arquivo, então não dá para fixá-lo.'}
                  onClick={() => usable && onPick(choice.ref!)}
                >
                  <span className="agenda-choice-ep">{episodeLabel(choice)}</span>
                  <span className="agenda-choice-title">{choice.title}</span>
                  <span className="agenda-tags">
                    {choice.current && <span className="agenda-tag">passa agora</span>}
                    {choice.picked && <span className="agenda-tag" data-tag="pinned">Fixo</span>}
                    {choice.blocked && <span className="agenda-tag" data-tag="blocked">não passar</span>}
                    {!usable && <span className="agenda-tag">sem número</span>}
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
