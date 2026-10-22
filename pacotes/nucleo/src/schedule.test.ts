import { describe, expect, it } from 'vitest';
import { parseSchedule } from './schedule';
import type { LibraryWarning } from './types';

function parse(text: string) {
  const warnings: LibraryWarning[] = [];
  const schedule = parseSchedule('grades/gominho-2003.yaml', text, warnings);
  return { schedule, messages: warnings.map((w) => w.message) };
}

describe('parseSchedule', () => {
  it('parses the documented example', () => {
    const { schedule, messages } = parse(`
nome: TV Globinho (2003)
data_inicio: 2003-03-03
dias: [seg, ter, qua, qui, sex]
blocos:
  - horario: "10:30"
    itens:
      - programa: digimon
  - horario: "08:00"
    itens:
      - vinheta: aberturas
      - programa: dragon-ball-z
      - comerciais: 3
      - programa: bob-esponja
        episodios: 2
`);
    expect(messages).toEqual([]);
    expect(schedule).toMatchObject({
      id: 'gominho-2003',
      name: 'TV Globinho (2003)',
      startDate: '2003-03-03',
      days: ['seg', 'ter', 'qua', 'qui', 'sex'],
    });
    // Blocks are sorted by time.
    expect(schedule!.blocks.map((b) => b.start)).toEqual([8 * 3600, 10.5 * 3600]);
    expect(schedule!.blocks[0]!.items).toEqual([
      { type: 'interstitial', ref: 'aberturas' },
      { type: 'show', show: 'dragon-ball-z', count: 1 },
      { type: 'commercials', count: 3 },
      { type: 'show', show: 'bob-esponja', count: 2 },
    ]);
  });

  it('accepts unquoted times and accented day names', () => {
    const { schedule, messages } = parse(`
nome: X
dias: [Sáb, domingo]
blocos:
  - horario: 08:00
    itens: [{ programa: a }]
`);
    expect(messages).toEqual([]);
    expect(schedule!.days).toEqual(['dom', 'sab']);
    expect(schedule!.blocks[0]!.start).toBe(8 * 3600);
  });

  it('skips bad blocks and items with clear warnings', () => {
    const { schedule, messages } = parse(`
nome: X
data_inicio: 03/03/2003
blocos:
  - horario: "25:00"
    itens: [{ programa: a }]
  - horario: "09:00"
    itens:
      - programa: a
        episodios: 0
      - filme: b
      - programa: c
`);
    expect(schedule!.startDate).toBe('2000-01-01');
    expect(schedule!.blocks).toEqual([{ start: 9 * 3600, items: [{ type: 'show', show: 'c', count: 1 }] }]);
    expect(messages).toHaveLength(4);
  });

  it('rejects broken YAML and empty schedules', () => {
    expect(parse('nome: [').schedule).toBeNull();
    expect(parse('nome: X').schedule).toBeNull();
  });
});
