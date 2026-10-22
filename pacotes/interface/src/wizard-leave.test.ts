import { DEFAULT_SETTINGS } from '@tv-gominho/nucleo';
import { describe, expect, it } from 'vitest';
import { CATEGORIES } from './settings-model';
import { initialState, stepHeading, wizardDirty } from './wizard-model';

describe('wizard header and leaving', () => {
  it('writes the screen as one short line', () => {
    expect(stepHeading('when')).toBe('Passo 1 de 4 · Quando?');
    expect(stepHeading('shows')).toBe('Passo 2 de 4 · O que passa?');
    expect(stepHeading('review')).toBe('Passo 3 de 4 · Nome e prévia');
    expect(stepHeading('save')).toBe('Passo 4 de 4 · Salvar');
    expect(stepHeading('advanced')).toBe('Ajustes avançados');
    expect(stepHeading('commercials')).toBe('Ajustes avançados · Comerciais');
    for (const step of ['when', 'shows', 'review', 'save', 'advanced', 'commercials', 'bumpers', 'replace'] as const) {
      expect(stepHeading(step)).not.toContain('\n');
      expect(stepHeading(step).length).toBeLessThan(48);
    }
  });

  it('asks before leaving from the second screen on or with changed answers, never on a fresh first screen', () => {
    const fresh = initialState(DEFAULT_SETTINGS.adBreaks);
    expect(wizardDirty('when', initialState(DEFAULT_SETTINGS.adBreaks), fresh)).toBe(false);
    expect(wizardDirty('shows', initialState(DEFAULT_SETTINGS.adBreaks), fresh)).toBe(true);
    expect(wizardDirty('when', { ...initialState(DEFAULT_SETTINGS.adBreaks), name: 'Outro' }, fresh)).toBe(true);
  });
});

describe('settings categories', () => {
  it('has no category called Programação (that name belongs to the schedule screen)', () => {
    expect(CATEGORIES.map((category) => category.label)).not.toContain('Programação');
    expect(CATEGORIES.find((category) => category.id === 'schedule')!.label).toBe('Como a TV passa');
  });
});
