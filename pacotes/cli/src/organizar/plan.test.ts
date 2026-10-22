import { describe, expect, it } from 'vitest';
import type { ChoiceAnswer } from '../jev/client';
import { bumperName, planOrganize, seasonOf, topTwo, type ClassifiedFile } from './plan';
import { LISTED_SHOWS, sampleNames, slugify } from './questions';

const answer = (choice: string, confidence = 0.95, runnerUp?: [string, number]): ChoiceAnswer => ({
  type: 'choice',
  choice,
  confidence,
  probabilities: { [choice]: confidence, ...(runnerUp ? { [runnerUp[0]]: runnerUp[1] } : {}) },
});

const nothing = (_path: string) => false;
const plan = (files: ClassifiedFile[], exists = nothing) => planOrganize(files, exists);

describe('slugify and the list', () => {
  it('makes folder names from titles', () => {
    expect(slugify('Yu-Gi-Oh! GX')).toBe('yu-gi-oh-gx');
    expect(slugify('Digimon (Digimon Adventure)')).toBe('digimon');
    expect(slugify('101 Dálmatas: A Série')).toBe('101-dalmatas-a-serie');
  });

  it('gives every listed show its own folder name', () => {
    const slugs = LISTED_SHOWS.map((show) => show.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    expect(slugs).toContain('dragon-ball-z');
    expect(LISTED_SHOWS.find((show) => show.slug === 'as-aventuras-de-mickey-donald')?.originalTitle).toBeUndefined(); // "a confirmar"
  });

  it('samples names spread over a big folder', () => {
    const names = Array.from({ length: 100 }, (_, i) => `${i}`);
    const sample = sampleNames(names, 5);
    expect(sample).toEqual(['0', '25', '50', '74', '99']);
    expect(sampleNames(['a', 'b'])).toEqual(['a', 'b']);
  });
});

describe('seasonOf', () => {
  it('reads the season from the name or the folder', () => {
    expect(seasonOf('Bob/S02E05 - Título.mp4')).toBe(2);
    expect(seasonOf('Padrinhos/Os Padrinhos Magicos - 3x12.avi')).toBe(3);
    expect(seasonOf('phineas.and.ferb.s01e01.720p.mkv')).toBe(1);
    expect(seasonOf('Bob Esponja Calça Quadrada T01/05 - Título.mp4')).toBe(1);
    expect(seasonOf('Bob/Temporada 2/05.mp4')).toBe(2);
    expect(seasonOf('DBZ/DBZ 145.avi')).toBeNull();
    expect(seasonOf('Digimon 01/Digimon Adventure 01.avi')).toBeNull();
    expect(seasonOf('x/video 1080x720.mp4')).toBeNull();
  });
});

describe('bumperName', () => {
  it('makes the name say the role the app reads', () => {
    expect(bumperName('volta ja globinho 2004.avi', 'entry')).toBe('entrada - volta ja globinho 2004.avi');
    expect(bumperName('estamos de volta.mp4', 'exit')).toBe('saida - estamos de volta.mp4');
    expect(bumperName('entrada-01.mp4', 'entry')).toBe('entrada-01.mp4');
    expect(bumperName('jetix bumper.mp4', 'any')).toBe('jetix bumper.mp4');
    // A name that says the opposite can't be fixed by a prefix.
    expect(bumperName('saida 2.mp4', 'entry')).toBeNull();
    expect(bumperName('entrada.mp4', 'any')).toBeNull();
  });
});

describe('planOrganize', () => {
  it('puts episodes of listed shows in their folder, by season, and writes their programa.yaml', () => {
    const result = plan([
      { path: 'DBZ Completo/DBZ 001.avi', role: answer('episodio'), show: answer('dragon-ball-z') },
      { path: 'Bob/S02E05 - Título.mp4', role: answer('episodio'), show: answer('bob-esponja') },
    ]);
    expect(result.entries).toEqual([
      { status: 'mover', from: 'DBZ Completo/DBZ 001.avi', to: 'programas/dragon-ball-z/episodios/DBZ 001.avi', role: 'episodio', show: 'dragon-ball-z' },
      { status: 'mover', from: 'Bob/S02E05 - Título.mp4', to: 'programas/bob-esponja/episodios/temporada-02/S02E05 - Título.mp4', role: 'episodio', show: 'bob-esponja' },
    ]);
    expect(result.newShows.map((show) => show.slug)).toEqual(['dragon-ball-z', 'bob-esponja']);
    expect(result.newShows[0]).toEqual({ slug: 'dragon-ball-z', title: 'Dragon Ball Z', originalTitle: 'Dragon Ball Z' });
  });

  it('does not write programa.yaml for a show already in the library', () => {
    const result = plan([{ path: 'DBZ/DBZ 001.avi', role: answer('episodio'), show: answer('dragon-ball-z') }], (p) => p === 'programas/dragon-ball-z');
    expect(result.newShows).toEqual([]);
  });

  it('names shows outside the list after their folder, unless the folder mixes shows', () => {
    const result = plan([
      { path: 'Ben 10/Ben 10 S01E01.mp4', role: answer('episodio'), show: answer('outro') },
      { path: 'desenhos/Pica Pau 22.avi', role: answer('episodio'), show: answer('outro'), mixedFolder: true },
      { path: 'solto.avi', role: answer('episodio'), show: answer('outro') },
    ]);
    expect(result.entries[0]).toMatchObject({ status: 'mover', to: 'programas/ben-10/episodios/temporada-01/Ben 10 S01E01.mp4' });
    expect(result.entries[1]).toMatchObject({ status: 'revisar' });
    expect(result.entries[2]).toMatchObject({ status: 'revisar' });
    expect(result.newShows).toEqual([]);
  });

  it('places station clips by role and brand', () => {
    const result = plan([
      { path: 'v/Abertura TV Globinho 2004.mp4', role: answer('abertura'), brand: answer('tv-globinho') },
      { path: 'v/encerramento.avi', role: answer('encerramento'), brand: answer('outra') },
      { path: 'v/volta ja globinho.avi', role: answer('intervalo_entrada'), brand: answer('tv-globinho') },
      { path: 'v/back to the show.mp4', role: answer('intervalo_saida'), brand: answer('cartoon-network') },
      { path: 'v/Jetix bumper.mp4', role: answer('intervalo_generico'), brand: answer('jetix') },
      { path: 'c/Tazos 2001.mp4', role: answer('comercial') },
      { path: 'c/Chamada DBZ.mp4', role: answer('chamada') },
    ]);
    expect(result.entries.map((entry) => (entry.status === 'mover' ? entry.to : entry.status))).toEqual([
      'vinhetas/aberturas/tv-globinho/Abertura TV Globinho 2004.mp4',
      'vinhetas/encerramentos/encerramento.avi',
      'vinhetas/intervalos/tv-globinho/entrada - volta ja globinho.avi',
      'vinhetas/intervalos/cartoon-network/saida - back to the show.mp4',
      'vinhetas/intervalos/jetix/Jetix bumper.mp4',
      'vinhetas/comerciais/Tazos 2001.mp4',
      'vinhetas/chamadas/Chamada DBZ.mp4',
    ]);
  });

  it('leaves movies and extras where they are', () => {
    const result = plan([
      { path: 'Filmes/Aladdin.mkv', role: answer('filme') },
      { path: 'DBZ/sample.avi', role: answer('extra') },
    ]);
    expect(result.entries).toEqual([
      { status: 'deixar', from: 'Filmes/Aladdin.mkv', role: 'filme' },
      { status: 'deixar', from: 'DBZ/sample.avi', role: 'extra' },
    ]);
  });

  it('sends uncertain answers to review, with the two likeliest options', () => {
    const result = plan([
      { path: 'v/globinho 2010 vinheta.mp4', role: answer('abertura', 0.5, ['intervalo_generico', 0.4]) },
      { path: 'x/A Volta.avi', role: answer('episodio'), show: answer('dragon-ball-z', 0.6, ['dragon-ball', 0.3]) },
      { path: 'v/bumper.mp4', role: answer('intervalo_generico'), brand: answer('jetix', 0.4) },
    ]);
    expect(result.entries.map((entry) => entry.status)).toEqual(['revisar', 'revisar', 'revisar']);
    expect(result.entries[0]).toMatchObject({ reason: 'não sei o que é: abertura 50% ou intervalo_generico 40%' });
    expect(result.entries[1]).toMatchObject({ reason: 'não sei de qual programa é: dragon-ball-z 60% ou dragon-ball 30%' });
  });

  it('never overwrites: existing files are skipped, two files for one place go to review', () => {
    const result = plan(
      [
        { path: 'a/DBZ 001.avi', role: answer('episodio'), show: answer('dragon-ball-z') },
        { path: 'b/DBZ 001.avi', role: answer('episodio'), show: answer('dragon-ball-z') },
        { path: 'c/DBZ 002.avi', role: answer('episodio'), show: answer('dragon-ball-z') },
      ],
      (p) => p === 'programas/dragon-ball-z/episodios/DBZ 002.avi',
    );
    expect(result.entries.map((entry) => entry.status)).toEqual(['mover', 'revisar', 'existe']);
  });

  it('formats the runner-up', () => {
    expect(topTwo(answer('a', 0.7, ['b', 0.2]))).toBe('a 70% ou b 20%');
  });
});
