import { DEFAULT_SETTINGS } from '@tv-gominho/nucleo';
import { describe, expect, it } from 'vitest';
import { CATEGORIES } from './settings-model';
import { initialState, stepHeading, wizardDirty } from './wizard-model';

describe('wizard header and leaving', () => {
  it('writes the step as one short line', () => {
    expect(stepHeading('ranges')).toBe('Passo 1 de 8 · Horários');
    expect(stepHeading('save')).toBe('Passo 8 de 8 · Salvar');
  });

  it('asks before leaving from step 2 on or with changed answers, never on a fresh first step', () => {
    const fresh = initialState(DEFAULT_SETTINGS.adBreaks);
    expect(wizardDirty('ranges', initialState(DEFAULT_SETTINGS.adBreaks), fresh)).toBe(false);
    expect(wizardDirty('days', initialState(DEFAULT_SETTINGS.adBreaks), fresh)).toBe(true);
    expect(wizardDirty('ranges', { ...initialState(DEFAULT_SETTINGS.adBreaks), name: 'Outro' }, fresh)).toBe(true);
  });
});

describe('settings categories', () => {
  it('has no category called Programação (that name belongs to the schedule screen)', () => {
    expect(CATEGORIES.map((category) => category.label)).not.toContain('Programação');
    expect(CATEGORIES.find((category) => category.id === 'schedule')!.label).toBe('Como a TV passa');
  });
});
