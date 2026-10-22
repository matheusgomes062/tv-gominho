import { describe, expect, it } from 'vitest';
import { parseSchedule } from './schedule';
import { parseSettings } from './settings';
import type { LibraryWarning } from './types';

// A bad `intervalos` value is dropped. The warning says where the rule then comes from: the general setting
// for a grade, the built-in default for the settings file.

const GRADE = (rules: string) => `nome: X\nintervalos:\n${rules}\nblocos:\n  - horario: "08:00"\n    itens:\n      - programa: dbz\n`;

describe('warnings of intervalos', () => {
  it('say a grade falls back to the general setting', () => {
    const warnings: LibraryWarning[] = [];
    const schedule = parseSchedule('grades/x.yaml', GRADE('  a_cada: muito\n  apos_episodio: talvez\n  comerciais: 2'), warnings);
    expect(schedule!.adBreaks).toEqual({ ads: 2 });
    expect(warnings.map((warning) => warning.message)).toEqual([
      expect.stringMatching(/"intervalos.a_cada" deve ser um número de 0 a 30.* Vale a regra da configuração geral\.$/),
      expect.stringMatching(/"intervalos.apos_episodio" deve ser sim ou não.* Vale a regra da configuração geral\.$/),
    ]);
    expect(warnings.some((warning) => warning.message.includes('Usando o padrão'))).toBe(false);
  });

  it('still say "Usando o padrão" in the settings file', () => {
    const warnings: LibraryWarning[] = [];
    parseSettings('configuracoes.yaml', 'intervalos:\n  a_cada: muito\n', warnings);
    expect(warnings[0]!.message).toMatch(/Usando o padrão\.$/);
  });
});
