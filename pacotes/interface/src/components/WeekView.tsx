import { Icon } from './Icon';
import type { Airing, WeekDay, WeekModel } from '../week-model';

interface Props {
  week: WeekModel;
  /** Names the list for screen readers: "A semana", "Semana de 19/10 a 25/10". */
  label: string;
  /** Makes the airings a button each (the ones a pick can be made on): the screen opens its list of episodes. */
  onPick?(airing: Airing): void;
}

/**
 * The week of a channel, one line per day with the airings of that day at the time they start. One component for the
 * preview of the wizard and the week of "Mudar uma programação", so both read the same. The days and times come from
 * week-model.ts. Without `onPick` each day is a stop for the arrow keys (so the remote can scroll through the week).
 */
export function WeekView({ week, label, onPick }: Props) {
  return (
    <ul className="week" aria-label={label}>
      {week.days.map((day) => (
        <DayRow key={day.date} day={day} onPick={onPick} />
      ))}
    </ul>
  );
}

function DayRow({ day, onPick }: { day: WeekDay; onPick?(airing: Airing): void }) {
  const pickable = onPick !== undefined && day.airings.some((airing) => airing.editable);
  return (
    <li
      className="week-day"
      data-day-section={day.date}
      data-today={day.today ? '' : undefined}
      data-off={day.airs ? undefined : ''}
      // A day with nothing to pick still takes focus, so the keys can scroll through it.
      tabIndex={pickable ? undefined : 0}
      data-nav={pickable ? undefined : ''}
    >
      <strong className="week-day-name">
        {day.label}
        {day.today && <span className="week-today">hoje</span>}
      </strong>
      {!day.airs ? (
        <span className="row-meta">O canal não passa neste dia.</span>
      ) : day.beforeStart ? (
        <span className="row-meta">O canal ainda não tinha começado.</span>
      ) : day.airings.length === 0 ? (
        <span className="row-meta">Nada passa neste dia.</span>
      ) : (
        <span className="week-airings">
          {day.airings.map((airing) => (
            <AiringChip key={airing.key} airing={airing} onPick={onPick} />
          ))}
        </span>
      )}
    </li>
  );
}

function AiringChip({ airing, onPick }: { airing: Airing; onPick?(airing: Airing): void }) {
  const description = `${airing.time}, ${airing.showTitle}, ${airing.label}${airing.title ? `: ${airing.title}` : ''}${airing.blocked ? '. Está em “não passar”' : ''}${airing.pinned ? '. Episódio fixado' : ''}`;
  const content = (
    <>
      <span className="week-time">{airing.time}</span>
      <span className="week-show">{airing.showTitle}</span>
      <span className="week-ep">{airing.label}</span>
      {(airing.pinned || airing.blocked) && (
        <span className="week-tags">
          {airing.pinned && (
            <span className="agenda-tag" data-tag="pinned">
              Fixo
            </span>
          )}
          {airing.blocked && (
            <span className="agenda-tag" data-tag="blocked">
              não passar
            </span>
          )}
        </span>
      )}
    </>
  );
  const attrs = {
    className: 'week-airing',
    'data-airing': airing.key,
    'data-pinned': airing.pinned ? '' : undefined,
    'data-blocked': airing.blocked ? '' : undefined,
    title: airing.title ? `${airing.label}: ${airing.title}` : airing.label,
  };
  if (!onPick || !airing.editable) {
    return <span {...attrs}>{content}</span>;
  }
  return (
    <button
      {...attrs}
      type="button"
      data-nav
      data-cell={`${airing.itemKey}|${airing.date}`}
      aria-label={description}
      title={airing.pinned ? 'Episódio fixado. Enter para trocar ou voltar ao dinâmico.' : `${attrs.title}. Enter para escolher o episódio.`}
      onClick={() => onPick(airing)}
    >
      {content}
    </button>
  );
}

/** The warnings of a week (a block that runs over the next, a hole nothing fills), one line each with the days they apply to. */
export function WeekWarnings({ week, only }: { week: WeekModel; /** Show only the warnings of this day's label (the day view of the wizard). */ only?: string }) {
  const warnings = only ? week.warnings.filter((warning) => warning.days.includes(only)) : week.warnings;
  return (
    <>
      {warnings.map((warning) => (
        <p key={warning.message} className="wizard-warning" role="note" tabIndex={0} data-nav data-warning={warning.kind}>
          <Icon name="alert" className="row-lead" />
          <span>
            {warning.message}
            {!only && warning.days.length > 0 && <em> ({warning.days.length === week.days.length ? 'todos os dias' : warning.days.join(', ')})</em>}
          </span>
        </p>
      ))}
    </>
  );
}
