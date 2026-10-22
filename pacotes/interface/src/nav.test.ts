import { describe, expect, it } from 'vitest';
import { pickNext, type NavItem } from './nav';

// The geometry of the arrow keys, with boxes laid out like the screens of the app (1280x720, the panel 770 wide).

const box = (left: number, top: number, width: number, height: number, extra: Partial<NavItem> = {}): NavItem => ({
  left,
  top,
  right: left + width,
  bottom: top + height,
  ...extra,
});
const UP: [number, number] = [0, -1];
const DOWN: [number, number] = [0, 1];
const LEFT: [number, number] = [-1, 0];
const RIGHT: [number, number] = [1, 0];

const footer = { zone: 'footer', row: 'footer' };

// The preview: two small buttons ("Um dia", "A semana"), the day stepper (a wide row), the list, and the footer.
const PREVIEW = [
  box(20, 100, 110, 44), // 0 Um dia
  box(140, 100, 130, 44), // 1 A semana
  box(20, 156, 730, 56), // 2 Dia ‹ ›
  box(20, 224, 730, 56), // 3 first row of the list
  box(20, 292, 730, 56), // 4 second row
  box(20, 640, 120, 44, footer), // 5 Voltar
  box(630, 640, 120, 44, footer), // 6 Avançar
];

describe('Up and Down', () => {
  it('goes from the first button to the row right below it, not to the footer', () => {
    expect(pickNext(PREVIEW, 0, DOWN)).toBe(2);
    expect(pickNext(PREVIEW, 1, DOWN)).toBe(2);
  });

  it('walks the rows one by one, and back up', () => {
    expect(pickNext(PREVIEW, 2, DOWN)).toBe(3);
    expect(pickNext(PREVIEW, 3, DOWN)).toBe(4);
    expect(pickNext(PREVIEW, 4, UP)).toBe(3);
    expect(pickNext(PREVIEW, 3, UP)).toBe(2);
    expect(pickNext(PREVIEW, 2, UP)).toBe(1);
  });

  it('reaches the footer from the last row, when nothing else lies below', () => {
    expect(pickNext(PREVIEW, 4, DOWN)).toBe(5);
  });

  it('prefers the body to the footer even when the next body control is below the footer (scrolled out of view)', () => {
    const items = [box(20, 600, 730, 56), box(20, 700, 730, 56), box(20, 640, 120, 44, footer)];
    expect(pickNext(items, 0, DOWN)).toBe(1);
  });

  it('goes up from the footer to the nearest control of the body that is above it', () => {
    expect(pickNext(PREVIEW, 5, UP)).toBe(4);
    expect(pickNext(PREVIEW, 6, UP)).toBe(4);
  });

  it('stays put when nothing lies that way', () => {
    expect(pickNext(PREVIEW, 0, UP)).toBeUndefined();
    expect(pickNext(PREVIEW, 5, DOWN)).toBeUndefined();
  });

  it('keeps the column in a grid of chips', () => {
    const chips = [box(20, 100, 100, 44), box(130, 100, 100, 44), box(240, 100, 100, 44), box(20, 156, 100, 44), box(130, 156, 100, 44), box(240, 156, 100, 44)];
    expect(pickNext(chips, 2, DOWN)).toBe(5);
    expect(pickNext(chips, 1, DOWN)).toBe(4);
    expect(pickNext(chips, 3, UP)).toBe(0);
  });
});

describe('Left and Right', () => {
  it('moves along a row of chips and stops at its ends', () => {
    expect(pickNext(PREVIEW, 0, RIGHT)).toBe(1);
    expect(pickNext(PREVIEW, 1, LEFT)).toBe(0);
    expect(pickNext(PREVIEW, 1, RIGHT)).toBeUndefined();
  });

  it('moves between the buttons of the footer', () => {
    expect(pickNext(PREVIEW, 5, RIGHT)).toBe(6);
    expect(pickNext(PREVIEW, 6, LEFT)).toBe(5);
  });

  it('does not leave the footer for a control of the body', () => {
    expect(pickNext(PREVIEW, 6, RIGHT)).toBeUndefined();
  });

  it('stays among the members of a row while there is one that way (the tabs, the week buttons)', () => {
    const week = { row: 'week' };
    const items = [box(20, 300, 150, 40, week), box(300, 300, 150, 40, week), box(600, 300, 150, 40, week), box(650, 100, 80, 40)];
    expect(pickNext(items, 0, RIGHT)).toBe(1);
    expect(pickNext(items, 1, RIGHT)).toBe(2);
    expect(pickNext(items, 2, LEFT)).toBe(1);
  });

  it('goes to the first control above when Down starts from the row, and to the first cell below', () => {
    const week = { row: 'week' };
    const items = [box(20, 100, 120, 40), box(20, 200, 150, 40, week), box(300, 200, 150, 40, week), box(20, 260, 700, 60), box(20, 640, 120, 44, footer)];
    expect(pickNext(items, 1, DOWN)).toBe(3);
    expect(pickNext(items, 2, DOWN)).toBe(3);
    expect(pickNext(items, 1, UP)).toBe(0);
  });
});

describe('edge cases', () => {
  it('returns undefined for an unknown start', () => {
    expect(pickNext(PREVIEW, 99, DOWN)).toBeUndefined();
  });

  it('ignores items that overlap the start or lie behind it', () => {
    const items = [box(20, 100, 100, 44), box(20, 100, 100, 44)];
    expect(pickNext(items, 0, DOWN)).toBeUndefined();
  });
});
