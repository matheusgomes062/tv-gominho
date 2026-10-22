import type { KeyboardEvent, MouseEvent, ReactNode } from 'react';
import { Icon, type IconName } from './Icon';

interface Props {
  /** One of several (radio, drawn as ○ and ●), or one that is on or off by itself (checkbox, ☐ and ☑). */
  kind: 'radio' | 'checkbox';
  /** 'mixed': a checkbox that is half on (a show with only some episodes blocked). */
  checked: boolean | 'mixed';
  label: ReactNode;
  meta?: ReactNode;
  /** A row can lead with an icon. */
  icon?: IconName;
  /** A row (list of options with their explanation) or a chip (short options side by side). */
  variant?: 'row' | 'chip';
  /** What a checked box shows: a check, or a cross for lists where "on" means "does not air". */
  mark?: 'check' | 'cross';
  /** The row keeps Left/Right for itself (see nav.ts). */
  adjust?: boolean;
  autofocus?: boolean;
  disabled?: boolean;
  title?: string;
  /** Something at the end of the row (the order box of a show). */
  children?: ReactNode;
  /** The `data-wizard` marker of the screen's tests and scripts. */
  data?: string;
  attrs?: Record<`data-${string}`, string | undefined>;
  onClick(event: MouseEvent<HTMLButtonElement>): void;
  onKeyDown?(event: KeyboardEvent<HTMLButtonElement>): void;
}

/**
 * The one control for choosing options, everywhere in the app. The indicator in front says what is chosen: ○ or ● for
 * one choice among several, ☐ or ☑ for each of a list; a chosen option is also tinted and has its edge in the accent.
 * Where the focus is has a separate mark that never looks like either: a bright ring around the option. So "chosen"
 * and "here" can be told apart at a glance, with the colours of any theme. OK chooses (or switches the box).
 */
export function Choice({ kind, checked, label, meta, icon, variant = 'row', mark = 'check', adjust, autofocus, disabled, title, children, data, attrs, onClick, onKeyDown }: Props) {
  return (
    <button
      type="button"
      data-nav
      data-nav-adjust={adjust ? '' : undefined}
      data-autofocus={autofocus ? '' : undefined}
      data-wizard={data}
      data-choice={kind}
      data-variant={variant}
      {...attrs}
      className="choice"
      role={kind}
      aria-checked={checked}
      aria-disabled={disabled || undefined}
      title={title}
      onClick={onClick}
      onKeyDown={onKeyDown}
    >
      <Mark kind={kind} checked={checked} cross={mark === 'cross'} />
      {icon && variant === 'row' && <Icon name={icon} className="row-lead" />}
      <span className="choice-text">
        <span className="choice-label">{label}</span>
        {meta && <span className="choice-meta">{meta}</span>}
      </span>
      {children}
    </button>
  );
}

/** The indicator alone: for a card that has its own look (the themes of Configurações). */
export function Mark({ kind, checked, cross }: { kind: 'radio' | 'checkbox'; checked: boolean | 'mixed'; cross?: boolean }) {
  return (
    <span className="choice-mark" data-kind={kind} data-on={checked === true} data-mixed={checked === 'mixed' || undefined} aria-hidden="true">
      {kind === 'checkbox' && checked === true && <Icon name={cross ? 'close' : 'check'} />}
    </span>
  );
}
