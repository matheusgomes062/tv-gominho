import { useEffect, useRef, type ReactNode } from 'react';
import { focusFirst, useFocusTrap, useSpatialNav } from '../nav';

interface Props {
  /** 'bottom': a sheet along the bottom edge. 'left': a panel on the left. */
  edge: 'bottom' | 'left';
  label: string;
  /** Called for Back/Esc/Backspace and for a click outside the surface. */
  onBack(): void;
  children: ReactNode;
  className?: string;
}

/**
 * A translucent layer over the live picture (the TV keeps playing underneath). Arrow keys move
 * focus only among its own [data-nav] elements, focus cannot leave it, and the first
 * [data-autofocus] (or [data-nav]) element gets focus when it opens.
 */
export function Overlay({ edge, label, onBack, children, className = '' }: Props) {
  const root = useRef<HTMLDivElement>(null);
  useSpatialNav(onBack, root);
  useFocusTrap(root);

  useEffect(() => {
    const container = root.current;
    if (!container) return;
    const target = container.querySelector<HTMLElement>('[data-autofocus]');
    if (target) target.focus();
    else focusFirst(container);
  }, []);

  return (
    <div ref={root} className={`overlay overlay-${edge} ${className}`}>
      <div className="overlay-scrim" onClick={onBack} />
      <div className="overlay-surface" role="dialog" aria-modal="true" aria-label={label}>
        {children}
      </div>
    </div>
  );
}

/** A row of key hints at the bottom of an overlay, e.g. [['← →', 'escolher'], ['Voltar', 'fechar']]. */
export function KeyHints({ hints }: { hints: Array<[keys: string, action: string]> }) {
  return (
    <p className="key-hints">
      {hints.map(([keys, action]) => (
        <span key={keys}>
          <kbd>{keys}</kbd> {action}
        </span>
      ))}
    </p>
  );
}
