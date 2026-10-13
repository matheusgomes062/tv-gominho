import { describe, expect, it } from 'vitest';
import { countDaysInSet, isoToDayNumber, parseTimeOfDay, weekdayOf, type Weekday } from './dates';
import { naturalCompare, parseEpisodeName, titleFromSlug } from './paths';
import { createRng, hashString } from './random';

describe('parseEpisodeName', () => {
  it.each([
    ['001 - A Volta de Goku.mp4', 1, '001', 'A Volta de Goku'],
    ['12_O Torneio.mp4', 12, '12', 'O Torneio'],
    ['7 Episódio Sete.mp4', 7, '7', 'Episódio Sete'],
    ['003.mp4', 3, '003', null],
    ['Especial de Natal.mp4', null, null, 'Especial de Natal'],
  ])('%s', (file, number, numberText, title) => {
    expect(parseEpisodeName(file)).toEqual({ number, numberText, title });
  });
});

describe('naturalCompare', () => {
  it('sorts numbers naturally and ignores case/accents', () => {
    expect(['10', '2', '1'].sort(naturalCompare)).toEqual(['1', '2', '10']);
    expect(naturalCompare('Árvore', 'arvore')).toBe(0);
  });
});

describe('titleFromSlug', () => {
  it('capitalizes words', () => expect(titleFromSlug('dragon-ball-z')).toBe('Dragon Ball Z'));
});

describe('dates', () => {
  it('knows weekdays', () => {
    expect(weekdayOf(isoToDayNumber('2003-03-03'))).toBe('seg');
    expect(weekdayOf(isoToDayNumber('2026-10-11'))).toBe('dom');
  });

  it('counts airing days in both directions', () => {
    const weekdays = new Set<Weekday>(['seg', 'ter', 'qua', 'qui', 'sex']);
    const monday = isoToDayNumber('2003-03-03');
    expect(countDaysInSet(monday, monday, weekdays)).toBe(0);
    expect(countDaysInSet(monday, monday + 1, weekdays)).toBe(1);
    expect(countDaysInSet(monday, monday + 7, weekdays)).toBe(5);
    expect(countDaysInSet(monday, monday + 15, weekdays)).toBe(11);
    expect(countDaysInSet(monday, monday - 7, weekdays)).toBe(-5);
  });

  it('parses times of day', () => {
    expect(parseTimeOfDay('08:00')).toBe(8 * 3600);
    expect(parseTimeOfDay('8:05:30')).toBe(8 * 3600 + 5 * 60 + 30);
    expect(parseTimeOfDay('24:00')).toBeNull();
    expect(parseTimeOfDay('oito')).toBeNull();
  });
});

describe('random', () => {
  it('is reproducible', () => {
    const a = createRng(hashString('x'));
    const b = createRng(hashString('x'));
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });
});
