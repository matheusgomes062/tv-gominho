import type { Library } from '@tv-gominho/nucleo';
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import {
  buildWeek,
  clearPick,
  dateLabel,
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
import type { EditorState } from '../editor-model';

interface Props {
  state: EditorState;
  library: Library;
  /** "YYYY-MM-DD": today. Earlier days are shown but not editable. */
  today: string;
  edit(change: (current: EditorState) => EditorState): void;
}

interface Open {
  itemKey: number;
  date: string;
}

const EMPTY_TEXT = { missing: 'Programa fora da biblioteca', blocked: 'Tudo em “não passar”', 'before-start': 'Antes da estreia' } as const;

/**
 * The "Agenda" tab of the channel editor: a week of the grade, one row per show item and one column per airing day,
 * each cell with the episode the TV plays (agenda-model.ts runs the TV engine on the grade as edited). Choosing a
 * cell lists the episodes of its show; picking one pins the cell and the days after it go on from there.
 */
export function AgendaWeek({ state, library, today, edit }: Props) {
  const [weekStart, setWeekStart] = useState(() => weekStartOf(today));
  const [open, setOpen] = useState<Open | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const grid = useMemo(() => buildWeek(state, library, weekStart, today), [state, library, weekStart, today]);
  const thisWeek = weekStartOf(today);

  const find = (target: Open): { row: AgendaRow; cell: AgendaCell } | null => {
    const r = grid.rows.findIndex((row) => row.itemKey === target.itemKey);
    const c = grid.dates.indexOf(target.date);
    return r >= 0 && c >= 0 ? { row: grid.rows[r]!, cell: grid.cells[r]![c]! } : null;
  };
  const chosen = open ? find(open) : null;

  /** Back to the cell that opened the list. */
  const close = (target: Open | null) => {
    setOpen(null);
    if (!target) return;
    requestAnimationFrame(() => root.current?.querySelector<HTMLElement>(`[data-cell="${target.itemKey}|${target.date}"]`)?.focus());
  };

  const goTo = (next: string) => {
    setOpen(null);
    setWeekStart(next);
  };

  // The list is below the grid: bring it into view and start on the episode that plays now.
  useEffect(() => {
    if (!open) return;
    const list = root.current?.querySelector<HTMLElement>('.agenda-chooser');
    list?.scrollIntoView({ block: 'nearest' });
    const start = list?.querySelector<HTMLElement>('[data-current]') ?? list?.querySelector<HTMLElement>('[data-choice]');
    start?.focus();
  }, [open]);

  if (grid.rows.length === 0) {
    return (
      <div className="agenda" ref={root}>
        <p className="panel-note" data-agenda-empty>
          Nenhum programa para mostrar. Acrescente um programa a um bloco (aba Blocos), com horário e quantidade válidos, e escolha pelo menos um dia.
        </p>
      </div>
    );
  }

  return (
    <div className="agenda" ref={root}>
      <p className="panel-note">
        Cada espaço mostra o episódio que a TV passa. Escolha um espaço para fixar o episódio daquele dia: os dias seguintes continuam a partir dele. As mudanças valem quando você salva o canal.
      </p>

      <div className="agenda-nav" role="group" aria-label="Semana">
        <button data-nav data-week="prev" className="action-tile small" onClick={() => goTo(shiftWeek(weekStart, -1))}>
          <Icon name="chevronLeft" className="action-icon" />
          <span>Semana anterior</span>
        </button>
        <strong className="agenda-week" aria-live="polite" data-week-label>
          {weekLabel(weekStart)}
        </strong>
        <button data-nav data-week="today" className="action-tile small" aria-disabled={weekStart === thisWeek || undefined} onClick={() => weekStart !== thisWeek && goTo(thisWeek)}>
          <Icon name="calendar" className="action-icon" />
          <span>Esta semana</span>
        </button>
        <button data-nav data-week="next" className="action-tile small" onClick={() => goTo(shiftWeek(weekStart, 1))}>
          <span>Próxima semana</span>
          <Icon name="chevronRight" className="action-icon" />
        </button>
      </div>

      {grid.dates.length === 0 ? (
        <p className="panel-note">O canal não passa em nenhum dia dessa semana.</p>
      ) : (
        <div className="agenda-scroll">
          <div className="agenda-grid" role="table" aria-label={`Agenda de ${weekLabel(weekStart)}`} style={{ gridTemplateColumns: `minmax(8em, 11em) repeat(${grid.dates.length}, minmax(8.5em, 1fr))` }}>
            <div className="agenda-head agenda-corner" role="columnheader" />
            {grid.dates.map((date) => (
              <div key={date} className="agenda-head" role="columnheader" data-today={date === today ? '' : undefined}>
                {dateLabel(date)}
              </div>
            ))}
            {grid.rows.map((row, r) => (
              <RowCells
                key={row.itemKey}
                row={row}
                cells={grid.cells[r]!}
                today={today}
                onOpen={(date) => setOpen({ itemKey: row.itemKey, date })}
              />
            ))}
          </div>
        </div>
      )}

      {open && chosen && (
        <Chooser
          library={library}
          row={chosen.row}
          cell={chosen.cell}
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

function RowCells({ row, cells, today, onOpen }: { row: AgendaRow; cells: AgendaCell[]; today: string; onOpen(date: string): void }) {
  return (
    <>
      <div className="agenda-label" role="rowheader">
        <span className="agenda-time">{row.blockTime}</span>
        <span className="agenda-show">{row.showTitle}</span>
        {row.count > 1 && <span className="row-meta">{row.count} episódios</span>}
      </div>
      {cells.map((cell) => (
        <CellView key={cell.date} row={row} cell={cell} today={today} onOpen={() => onOpen(cell.date)} />
      ))}
    </>
  );
}

function CellView({ row, cell, today, onOpen }: { row: AgendaRow; cell: AgendaCell; today: string; onOpen(): void }) {
  const first = cell.episodes[0];
  const pinned = cell.pick !== null;
  const describe = first
    ? `${first.number === null ? '' : `${episodeLabel(first)} `}${first.title}`
    : cell.empty
      ? EMPTY_TEXT[cell.empty]
      : 'Nada passa';
  const label = `${row.showTitle}, ${dateLabel(cell.date)}, ${row.blockTime}: ${describe}${cell.more > 0 ? ` e mais ${cell.more}` : ''}${pinned ? '. Episódio fixado' : cell.drawn ? '. Sorteado' : '. Dinâmico'}`;
  const content = (
    <>
      {first ? (
        <>
          <span className="agenda-ep">{first.number === null ? first.title : episodeLabel(first)}</span>
          {first.number !== null && <span className="agenda-title">{first.title}</span>}
        </>
      ) : (
        <span className="agenda-none">{cell.empty ? EMPTY_TEXT[cell.empty] : 'Nada passa'}</span>
      )}
      <span className="agenda-tags">
        {cell.more > 0 && <span className="agenda-more">+{cell.more}</span>}
        {first?.blocked && <span className="agenda-tag" data-tag="blocked">não passar</span>}
        {pinned && (
          <span className="agenda-tag" data-tag="pinned">
            {cell.pick!.found ? 'Fixo' : 'Fixo (sumiu)'}
          </span>
        )}
        {!pinned && cell.drawn && first && <span className="agenda-tag">sorteio</span>}
      </span>
    </>
  );
  const attrs = {
    className: 'agenda-cell',
    role: 'cell' as const,
    'data-cell': `${row.itemKey}|${cell.date}`,
    'data-pinned': pinned ? '' : undefined,
    'data-today': cell.date === today ? '' : undefined,
    'data-empty': first ? undefined : '',
    'aria-label': label,
  };
  if (!cell.editable) {
    return (
      <div {...attrs} data-locked="">
        {content}
      </div>
    );
  }
  return (
    <button {...attrs} data-nav onClick={onOpen} title={pinned ? 'Episódio fixado. Enter para trocar ou voltar ao dinâmico.' : 'Enter para escolher o episódio'}>
      {content}
    </button>
  );
}

function Chooser({
  library,
  row,
  cell,
  onPick,
  onReset,
  onCancel,
}: {
  library: Library;
  row: AgendaRow;
  cell: AgendaCell;
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
    <section className="agenda-chooser" aria-label={`Escolher o episódio de ${row.showTitle} em ${dateLabel(cell.date)}`} onKeyDown={onKeyDown} data-chooser>
      <header className="agenda-chooser-head">
        <h3>
          {row.showTitle} <span className="row-meta">{dateLabel(cell.date)}, {row.blockTime}</span>
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
