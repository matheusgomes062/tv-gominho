import { DEFAULT_AD_BREAKS, scanLibrary, type Library, type LibrarySource, type Proposal } from '@tv-gominho/nucleo';
import { beforeAll, describe, expect, it } from 'vitest';
import { afterProposal, applyProposal, checkProposal, currentChoices, iaReply, requestProblem, typicalMinutes } from './ia-model';
import { buildChannel, firstProblemStep, initialState } from './wizard-model';

const FILES: Record<string, string> = {
  'programas/dbz/programa.yaml': 'titulo: DBZ',
  'programas/dbz/episodios/001.mp4': '',
  'programas/dbz/episodios/002.mp4': '',
  'programas/pinguins/programa.yaml': 'titulo: Pinguins',
  'programas/pinguins/episodios/001.mp4': '',
  'vinhetas/aberturas/tv-globinho/Abertura (2003-2009).mp4': '',
  'grades/manha.yaml': 'nome: Manhã\nblocos:\n  - horario: "08:00"\n    itens:\n      - programa: dbz\n',
};

const source = (files: Record<string, string>): LibrarySource => ({ files: Object.keys(files), readText: async (path) => files[path] ?? '' });

let library: Library;
beforeAll(async () => {
  library = await scanLibrary(source(FILES));
});

const PROPOSAL: Proposal = {
  name: 'Tarde de sábado',
  ranges: [{ start: 14 * 3600, end: 16 * 3600 }],
  days: ['dom', 'sab'],
  shows: ['pinguins', 'dbz'],
  adBreaks: { every: 0, ads: 2, afterEpisode: true, bumpers: false },
  brand: 'tv-globinho',
  era: 2004,
  note: 'Duas horas.',
};

describe('applyProposal', () => {
  it('fills every answer of the wizard, as a new channel, ready for the preview', () => {
    const replacing = { ...initialState(), target: 'manha', confirmed: true };
    const state = applyProposal(replacing, PROPOSAL);
    expect(state).toMatchObject({
      preset: 'custom',
      ranges: PROPOSAL.ranges,
      days: ['dom', 'sab'],
      showMode: 'pick',
      picked: ['pinguins', 'dbz'],
      adMode: 'custom',
      ad: PROPOSAL.adBreaks,
      brand: 'tv-globinho',
      era: 2004,
      name: 'Tarde de sábado',
      target: null,
      confirmed: false,
    });
    expect(firstProblemStep(state, 2)).toBe(null);
    const built = buildChannel({ state, library, durationOf: () => 600, settings: undefined, today: '2026-10-24', taken: ['manha'] });
    expect(built.replaces).toBeNull();
    expect(built.generated.schedule.days).toEqual(['dom', 'sab']);
  });

  it('recognizes a preset and "every show"', () => {
    const state = applyProposal(initialState(), { ...PROPOSAL, ranges: [{ start: 8 * 3600, end: 12 * 3600 }], shows: [], adBreaks: null });
    expect(state.preset).toBe('morning');
    expect(state.showMode).toBe('all');
    expect(state.adMode).toBe('general');
    expect(state.ad).toEqual(DEFAULT_AD_BREAKS);
  });
});

describe('afterProposal', () => {
  it('opens "Nome e prévia" for a proposal that fits', () => {
    expect(afterProposal(applyProposal(initialState(), PROPOSAL), 2)).toBe('review');
  });

  it('stops at the earlier screen that has a problem with the answers', () => {
    const state = applyProposal(initialState(), PROPOSAL);
    expect(afterProposal({ ...state, days: [] }, 2)).toBe('when');
    expect(afterProposal(state, 0)).toBe('shows');
  });

  it('leaves the name for the preview screen, where it can be fixed', () => {
    expect(afterProposal({ ...applyProposal(initialState(), PROPOSAL), name: '' }, 2)).toBe('review');
  });
});

describe('iaReply', () => {
  it('checks the proposal again against the library of the app', () => {
    expect(iaReply(200, { proposta: PROPOSAL }, library)).toEqual({ kind: 'proposal', proposal: PROPOSAL });
    expect(iaReply(200, { proposta: { ...PROPOSAL, shows: ['naruto'] } }, library).kind).toBe('error');
    expect(checkProposal(null, library).kind).toBe('error');
  });

  it('asks for the PIN again, and shows the messages of the server', () => {
    expect(iaReply(401, { erro: 'x' }, library)).toEqual({ kind: 'needs-pin' });
    expect(iaReply(429, { erro: 'Espere 5 s para pedir de novo.' }, library)).toEqual({ kind: 'error', message: 'Espere 5 s para pedir de novo.' });
    expect(iaReply(500, null, library).kind).toBe('error');
  });
});

describe('the request', () => {
  it('must say something, in at most 500 letters', () => {
    expect(requestProblem('  ')).not.toBeNull();
    expect(requestProblem('a'.repeat(501))).not.toBeNull();
    expect(requestProblem('uma manhã calma')).toBeNull();
  });

  it('sends the answers chosen so far, but not the untouched defaults', () => {
    expect(currentChoices(initialState(), DEFAULT_AD_BREAKS)).toBeNull();
    const chosen = currentChoices({ ...initialState(), days: ['sab'] }, DEFAULT_AD_BREAKS);
    expect(chosen).toMatchObject({ days: ['sab'], shows: [], adBreaks: null, ranges: [{ start: 8 * 3600, end: 12 * 3600 }] });
  });

  it('sends typical episode lengths in minutes, only where known', () => {
    const minutes = typicalMinutes(library.shows, (path) => (path.includes('dbz') ? 21 * 60 + 20 : undefined));
    expect(minutes).toEqual({ dbz: 21 });
  });
});
