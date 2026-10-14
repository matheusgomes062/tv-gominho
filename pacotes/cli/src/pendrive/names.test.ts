import { describe, expect, it } from 'vitest';
import { digitsFor, fatSafeName, isPartFileName, partFileName, partNaming, partialName } from './names';

describe('part names', () => {
  it('zero-pads the day so alphabetical order is playing order', () => {
    const naming = partNaming(5, 2);
    expect(partFileName(1, 1, naming)).toBe('Dia 01 - Parte 1.mp4');
    expect(partFileName(5, 2, naming)).toBe('Dia 05 - Parte 2.mp4');
    const names = [10, 2, 1, 21].map((day) => partFileName(day, 1, partNaming(30, 1)));
    expect([...names].sort()).toEqual([1, 2, 10, 21].map((day) => partFileName(day, 1, partNaming(30, 1))));
  });

  it('adds digits when there are more than 99 days or 9 parts', () => {
    expect(partNaming(120, 3)).toEqual({ dayDigits: 3, partDigits: 1 });
    expect(partFileName(7, 12, partNaming(120, 12))).toBe('Dia 007 - Parte 12.mp4');
    expect(partNaming(5, 10)).toEqual({ dayDigits: 2, partDigits: 2 });
    expect(partFileName(1, 3, partNaming(5, 10))).toBe('Dia 01 - Parte 03.mp4');
    expect(digitsFor(99, 2)).toBe(2);
    expect(digitsFor(100, 2)).toBe(3);
  });

  it('never produces a character FAT32 refuses', () => {
    const name = partFileName(3, 1, partNaming(5, 1));
    expect(name).not.toMatch(/[<>:"/\|?*]/);
  });

  it('recognises its own files', () => {
    expect(isPartFileName('Dia 01 - Parte 1.mp4')).toBe(true);
    expect(isPartFileName('Dia 120 - Parte 02.mp4')).toBe(true);
    expect(isPartFileName('Dia 01 - Parte 1.mp4.parcial')).toBe(false);
    expect(isPartFileName('Meu filme.mp4')).toBe(false);
  });

  it('names half-written files so no player lists them', () => {
    expect(partialName('Dia 01 - Parte 1.mp4')).toBe('.Dia 01 - Parte 1.mp4.parcial');
  });
});

describe('fatSafeName', () => {
  it('replaces what FAT32 forbids and trims trailing dots and spaces', () => {
    expect(fatSafeName('Dia 01: Parte 1?.mp4')).toBe('Dia 01- Parte 1-.mp4');
    expect(fatSafeName('nome. ')).toBe('nome');
    expect(fatSafeName('a<b>c|d')).toBe('a-b-c-d');
  });

  it('avoids Windows device names', () => {
    expect(fatSafeName('CON')).toBe('_CON');
    expect(fatSafeName('aux.txt')).toBe('_aux.txt');
    expect(fatSafeName('console')).toBe('console');
  });
});
