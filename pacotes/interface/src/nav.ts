import { useEffect } from 'react';

// Remote-control style navigation: arrow keys move focus to the nearest
// [data-nav] element in that direction; Enter clicks it (native for buttons).
// An element with [data-nav-adjust] (e.g. a settings row) keeps Left/Right for
// itself: it handles them in its own onKeyDown instead of moving focus.

const DIRECTIONS: Record<string, [number, number]> = {
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
};

export const BACK_KEYS = new Set(['Escape', 'Backspace', 'BrowserBack', 'GoBack']);

function center(element: Element) {
  const rect = element.getBoundingClientRect();
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, visible: rect.width > 0 && rect.height > 0 };
}

export function focusFirst(container: ParentNode = document) {
  container.querySelector<HTMLElement>('[data-nav]')?.focus();
}

function moveFocus([dx, dy]: [number, number]) {
  const elements = [...document.querySelectorAll<HTMLElement>('[data-nav]')].filter((el) => center(el).visible);
  const current = document.activeElement as HTMLElement | null;
  if (!current || !elements.includes(current)) {
    elements[0]?.focus();
    return;
  }
  const from = center(current);
  let best: HTMLElement | undefined;
  let bestScore = Infinity;
  for (const element of elements) {
    if (element === current) continue;
    const to = center(element);
    const along = (to.x - from.x) * dx + (to.y - from.y) * dy;
    if (along <= 1) continue;
    const across = Math.abs((to.x - from.x) * dy - (to.y - from.y) * dx);
    const score = along + across * 2;
    if (score < bestScore) {
      bestScore = score;
      best = element;
    }
  }
  if (best) {
    best.focus();
    best.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
  }
}

/** Enables arrow-key navigation and calls `onBack` for Esc/Backspace while mounted. */
export function useSpatialNav(onBack?: () => void) {
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const direction = DIRECTIONS[event.key];
      if (direction) {
        if (direction[0] !== 0 && document.activeElement?.hasAttribute('data-nav-adjust')) return;
        event.preventDefault();
        moveFocus(direction);
      } else if (BACK_KEYS.has(event.key) && onBack) {
        event.preventDefault();
        onBack();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onBack]);
}
