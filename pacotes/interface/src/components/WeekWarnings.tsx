import { Icon } from './Icon';
import type { WeekModel } from '../week-model';

/** The warnings of a week (a block that runs over the next, a hole nothing fills), one line each with the days they apply to. */
export function WeekWarnings({ week }: { week: WeekModel }) {
  const { warnings } = week;
  return (
    <>
      {warnings.map((warning) => (
        <p key={warning.message} className="wizard-warning" role="note" tabIndex={0} data-nav data-warning={warning.kind}>
          <Icon name="alert" className="row-lead" />
          <span>
            {warning.message}
            {warning.days.length > 0 && <em> ({warning.days.length === week.days.length ? 'todos os dias' : warning.days.join(', ')})</em>}
          </span>
        </p>
      ))}
    </>
  );
}
