import { useEffect, type RefObject } from 'react';

// Remote-control style navigation: arrow keys move focus to the nearest
// [data-nav] element in that direction; Enter clicks it (native for buttons).
// An element with [data-nav-adjust] (e.g. a settings row) keeps Left/Right for
// itself: it handles them in its own onKeyDown instead of moving focus.
// With a `scope` (an overlay's root), only the [data-nav] elements inside it take part.
// Two optional markers shape the moves (see pickNext): [data-nav-zone] on an area such as the footer, which Up/Down
// reach only when nothing else lies that way, and [data-nav-row] on a group of buttons that Left/Right move between.

const DIRECTIONS: Record<string, [number, number]> = {
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
};

export const BACK_KEYS = new Set(['Escape', 'Backspace', 'BrowserBack', 'GoBack']);

/** The box of a [data-nav] element on screen, and the groups it belongs to. */
export interface NavItem {
  left: number;
  top: number;
  right: number;
  bottom: number;
  /** A region of the screen (the footer, say): Up/Down prefer items of the current region. */
  zone?: unknown;
  /** A row of buttons: Left and Right stay among its members. */
  row?: unknown;
}

const centerX = (item: NavItem) => (item.left + item.right) / 2;
const centerY = (item: NavItem) => (item.top + item.bottom) / 2;

/** The empty space between two boxes on the axis across the move (0 when they overlap there). */
function gapAcross(a: NavItem, b: NavItem, vertical: boolean): number {
  return vertical
    ? Math.max(0, Math.max(a.left, b.left) - Math.min(a.right, b.right))
    : Math.max(0, Math.max(a.top, b.top) - Math.min(a.bottom, b.bottom));
}

/**
 * The index of the item that arrow `[dx, dy]` moves focus to from item `from`, or undefined when nothing lies that way.
 * Distance counts along the move, plus how far the box sits off to the side (a wide row right below a narrow button
 * counts as straight below it, not as far away). Then, in order:
 * - Left and Right stay inside the current row while it has an item that way;
 * - Left and Right never cross into another zone;
 * - Up and Down prefer items of the current zone, so a control of the body never jumps to the footer over the controls
 *   below it; the footer (or any other zone) is reached only when nothing else lies in that direction.
 */
export function pickNext(items: readonly NavItem[], from: number, [dx, dy]: [number, number]): number | undefined {
  const current = items[from];
  if (!current) return undefined;
  const vertical = dy !== 0;
  const candidates: Array<{ index: number; score: number }> = [];
  items.forEach((item, index) => {
    if (index === from) return;
    const along = (centerX(item) - centerX(current)) * dx + (centerY(item) - centerY(current)) * dy;
    if (along <= 1) return;
    const gap = gapAcross(current, item, vertical);
    // Left and Right only reach what shares a line with the current item: a row above or below is not 'to the right'.
    if (!vertical && gap > 0) return;
    const offset = Math.abs(vertical ? centerX(item) - centerX(current) : centerY(item) - centerY(current));
    candidates.push({ index, score: along + gap * 2 + offset * 0.3 });
  });
  const best = (list: typeof candidates) => list.reduce<(typeof candidates)[number] | undefined>((top, entry) => (!top || entry.score < top.score ? entry : top), undefined)?.index;
  const sameZone = candidates.filter(({ index }) => items[index]!.zone === current.zone);
  if (!vertical) {
    const sameRow = current.row === undefined ? [] : sameZone.filter(({ index }) => items[index]!.row === current.row);
    return best(sameRow.length > 0 ? sameRow : sameZone);
  }
  return best(sameZone.length > 0 ? sameZone : candidates);
}

export function focusFirst(container: ParentNode = document) {
  container.querySelector<HTMLElement>('[data-nav]')?.focus();
}

/** Keeps keyboard focus inside `root` while it is mounted (an overlay): focus that escapes comes back. */
export function useFocusTrap(root: RefObject<HTMLElement | null>, enabled = true) {
  useEffect(() => {
    const container = root.current;
    if (!container || !enabled) return;
    const onFocusIn = (event: FocusEvent) => {
      if (event.target instanceof Node && !container.contains(event.target)) focusFirst(container);
    };
    document.addEventListener('focusin', onFocusIn);
    return () => document.removeEventListener('focusin', onFocusIn);
  }, [root, enabled]);
}

function moveFocus(direction: [number, number], scope?: ParentNode) {
  const elements = [...(scope ?? document).querySelectorAll<HTMLElement>('[data-nav]')].filter((el) => {
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  });
  const current = document.activeElement as HTMLElement | null;
  if (!current || !elements.includes(current)) {
    elements[0]?.focus();
    return;
  }
  const items = elements.map<NavItem>((el) => {
    const rect = el.getBoundingClientRect();
    return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, zone: el.closest('[data-nav-zone]'), row: el.closest('[data-nav-row]') ?? undefined };
  });
  const target = elements[pickNext(items, elements.indexOf(current), direction) ?? -1];
  if (target) {
    target.focus();
    target.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
  }
}

/** Enables arrow-key navigation and calls `onBack` for Esc/Backspace while mounted. */
export function useSpatialNav(onBack?: () => void, scope?: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const direction = DIRECTIONS[event.key];
      if (direction) {
        if (direction[0] !== 0 && document.activeElement?.hasAttribute('data-nav-adjust')) return;
        event.preventDefault();
        moveFocus(direction, scope?.current ?? undefined);
      } else if (BACK_KEYS.has(event.key) && onBack) {
        event.preventDefault();
        onBack();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onBack, scope]);
}
