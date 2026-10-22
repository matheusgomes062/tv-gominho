import { beforeAll, describe, expect, it } from 'vitest';
import { scanLibrary } from './library';
import { MAX_PROPOSAL_TEXT, parseProposal, proposalSchema, proposalToRaw, validateProposal } from './proposal';
import { memorySource } from './test-helpers';
import type { Library } from './types';

const FILES: Record<string, string> = {
  'programas/dbz/programa.yaml': 'titulo: DBZ',
  'programas/dbz/episodios/001.mp4': '',
  'programas/pinguins/programa.yaml': 'titulo: Pinguins',
  'programas/pinguins/episodios/001.mp4': '',
  'programas/vazio/programa.yaml': 'titulo: Vazio',
  'vinhetas/aberturas/tv-globinho/Abertura (2003-2009).mp4': '',
  'vinhetas/intervalos/cartoon-network/entrada.mp4': '',
};

let library: Library;
beforeAll(async () => {
  library = await scanLibrary(memorySource(FILES));
});

const good = () => ({
  nome: 'Manhã calma',
  faixas: [{ inicio: '08:00', fim: '11:00' }],
  dias: ['seg', 'ter'],
  programas: ['pinguins', 'dbz'],
  comerciais: { proprios: true, a_cada_minutos: 8, por_intervalo: 2, depois_do_episodio: true, vinhetas_no_intervalo: false },
  marca: 'tv-globinho',
  epoca: 2004,
  explicacao: 'Três horas de desenhos.',
});

describe('validateProposal', () => {
  it('accepts a proposal that fits the library', () => {
    const result = validateProposal(good(), library);
    expect(result).toEqual({
      ok: true,
      proposal: {
        name: 'Manhã calma',
        ranges: [{ start: 8 * 3600, end: 11 * 3600 }],
        days: ['seg', 'ter'],
        shows: ['pinguins', 'dbz'],
        adBreaks: { every: 8, ads: 2, afterEpisode: true, bumpers: false },
        brand: 'tv-globinho',
        era: 2004,
        note: 'Três horas de desenhos.',
      },
    });
  });

  it('round-trips through the schema shape', () => {
    const first = validateProposal(good(), library);
    if (!first.ok) throw new Error(first.error);
    expect(validateProposal(proposalToRaw(first.proposal), library)).toEqual(first);
  });

  it('rejects shows that are not in the library, or have no episodes', () => {
    expect(validateProposal({ ...good(), programas: ['naruto'] }, library)).toEqual({ ok: false, error: expect.stringContaining('“naruto”') });
    expect(validateProposal({ ...good(), programas: ['vazio'] }, library).ok).toBe(false);
  });

  it('rejects unknown bumper brands and eras', () => {
    expect(validateProposal({ ...good(), marca: 'sbt' }, library).ok).toBe(false);
    expect(validateProposal({ ...good(), epoca: 1990 }, library).ok).toBe(false);
    // "" and null mean any brand and any era.
    expect(validateProposal({ ...good(), marca: '', epoca: null }, library).ok).toBe(true);
  });

  it.each([
    ['no ranges', { faixas: [] }],
    ['too many ranges', { faixas: ['06:00', '08:00', '10:00', '12:00'].map((inicio, i) => ({ inicio, fim: `0${i + 6}:30` })) }],
    ['a time that does not exist', { faixas: [{ inicio: '25:00', fim: '26:00' }] }],
    ['an end before the start', { faixas: [{ inicio: '11:00', fim: '08:00' }] }],
    ['overlapping ranges', { faixas: [{ inicio: '08:00', fim: '10:00' }, { inicio: '09:00', fim: '11:00' }] }],
    ['no days', { dias: [] }],
    ['an unknown day', { dias: ['segunda'] }],
    ['no name', { nome: '  ' }],
    ['a long name', { nome: 'x'.repeat(41) }],
    ['incomplete break rules', { comerciais: { proprios: true } }],
    ['more shows than the library has', { programas: ['dbz', 'dbz', 'pinguins'] }],
  ])('rejects %s', (_, patch) => {
    const result = validateProposal({ ...good(), ...patch }, library);
    expect(result.ok).toBe(false);
  });

  it('snaps times to 15 minutes and clamps the break numbers', () => {
    const result = validateProposal(
      { ...good(), faixas: [{ inicio: '08:07', fim: '10:52' }], comerciais: { proprios: true, a_cada_minutos: 99, por_intervalo: 0, depois_do_episodio: false, vinhetas_no_intervalo: true } },
      library,
    );
    if (!result.ok) throw new Error(result.error);
    expect(result.proposal.ranges).toEqual([{ start: 8 * 3600, end: 10 * 3600 + 45 * 60 }]);
    expect(result.proposal.adBreaks).toEqual({ every: 30, ads: 1, afterEpisode: false, bumpers: true });
  });

  it('follows the general break rules when the proposal has none of its own', () => {
    const result = validateProposal({ ...good(), comerciais: { proprios: false } }, library);
    expect(result.ok && result.proposal.adBreaks).toBeNull();
  });

  it('keeps the explanation short', () => {
    const result = validateProposal({ ...good(), explicacao: 'a'.repeat(1000) }, library);
    expect(result.ok && result.proposal.note.length).toBe(300);
  });
});

describe('parseProposal', () => {
  it('refuses text that is not JSON or is oversized', () => {
    expect(parseProposal('Claro! Aqui vai', library).ok).toBe(false);
    expect(parseProposal(JSON.stringify({ ...good(), explicacao: 'a'.repeat(MAX_PROPOSAL_TEXT) }), library)).toEqual({ ok: false, error: expect.stringContaining('grande demais') });
    expect(parseProposal(JSON.stringify(good()), library).ok).toBe(true);
  });
});

describe('proposalSchema', () => {
  it('lists only the playable shows and the brands of the library', () => {
    const schema = proposalSchema(library) as { properties: Record<string, { items?: { enum?: string[] }; enum?: string[] }> };
    expect(schema.properties.programas!.items!.enum).toEqual(['dbz', 'pinguins']);
    expect(schema.properties.marca!.enum).toEqual(['', 'cartoon-network', 'tv-globinho']);
  });
});
