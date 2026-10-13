import { describe, expect, it } from 'vitest';
import { resolveInterstitials, scanLibrary } from './library';
import { memorySource } from './test-helpers';

const GRADE = `
nome: Teste
data_inicio: 2003-03-03
dias: [seg, ter, qua, qui, sex]
blocos:
  - horario: "08:00"
    itens:
      - vinheta: aberturas
      - programa: dbz
      - programa: nao-existe
      - vinheta: inexistente
`;

describe('scanLibrary', () => {
  it('reads shows, episodes, bumpers and schedules', async () => {
    const library = await scanLibrary(
      memorySource({
        'programas/dbz/programa.yaml': 'titulo: Dragon Ball Z\nano: 1989\n',
        'programas/dbz/capa.JPG': '',
        'programas/dbz/episodios.yaml': '001:\n  titulo: Título do YAML\n',
        'programas/dbz/episodios/010 - Dez.mp4': '',
        'programas/dbz/episodios/002 - Dois.mp4': '',
        'programas/dbz/episodios/001 - Um.mp4': '',
        'programas/dbz/episodios/003 - Tres.avi': '',
        'programas/bob/episodios/temporada-02/001.mp4': '',
        'programas/bob/episodios/temporada-01/002 - B.mp4': '',
        'programas/bob/episodios/temporada-01/001 - A.mp4': '',
        'programas/vazio/programa.yaml': 'titulo: Vazio',
        'vinhetas/aberturas/2003/abertura.mp4': '',
        'vinhetas/intervalos/volta-ja.mp4': '',
        'vinhetas/solta.mp4': '',
        'grades/teste.yaml': GRADE,
        '.DS_Store': '',
      }),
    );

    expect(library.root).toBe('');
    expect(library.shows.map((show) => show.title)).toEqual(['Bob', 'Dragon Ball Z']);

    const dbz = library.shows[1]!;
    expect(dbz.year).toBe(1989);
    expect(dbz.poster).toBe('programas/dbz/capa.JPG');
    expect(dbz.episodes.map((e) => e.title)).toEqual(['Título do YAML', 'Dois', 'Dez']);

    const bob = library.shows[0]!;
    expect(bob.episodes.map((e) => [e.season, e.title])).toEqual([
      ['temporada-01', 'A'],
      ['temporada-01', 'B'],
      ['temporada-02', 'Episódio 1'],
    ]);

    expect(library.interstitials.map((i) => i.relativePath)).toEqual([
      'aberturas/2003/abertura.mp4',
      'intervalos/volta-ja.mp4',
    ]);
    expect(library.schedules.map((s) => s.name)).toEqual(['Teste']);

    const messages = library.warnings.map((w) => w.message).join('\n');
    expect(messages).toContain('.avi');
    expect(messages).toContain('"vazio" não tem episódios');
    expect(messages).toContain('"bob" não tem programa.yaml');
    expect(messages).toContain('fora de uma categoria');
    expect(messages).toContain('"nao-existe"');
    expect(messages).toContain('"inexistente"');
  });

  it('finds a library inside a "biblioteca" folder (USB stick root)', async () => {
    const library = await scanLibrary(
      memorySource({
        'ASSISTA AQUI/Dia 01.mp4': '',
        'biblioteca/programas/dbz/episodios/001.mp4': '',
      }),
    );
    expect(library.root).toBe('biblioteca/');
    expect(library.shows[0]?.episodes[0]?.path).toBe('biblioteca/programas/dbz/episodios/001.mp4');
  });

  it('warns when the folder is not a library', async () => {
    const library = await scanLibrary(memorySource({ 'fotos/praia.jpg': '' }));
    expect(library.shows).toEqual([]);
    expect(library.warnings[0]?.message).toContain('Nenhuma pasta');
  });

  it('resolves bumpers by category, subfolder or file', async () => {
    const library = await scanLibrary(
      memorySource({
        'vinhetas/aberturas/a.mp4': '',
        'vinhetas/aberturas/2003/b.mp4': '',
        'vinhetas/aberturas-extra/c.mp4': '',
      }),
    );
    const paths = (ref: string) => resolveInterstitials(library, ref).map((i) => i.relativePath);
    expect(paths('aberturas')).toEqual(['aberturas/2003/b.mp4', 'aberturas/a.mp4']);
    expect(paths('aberturas/2003')).toEqual(['aberturas/2003/b.mp4']);
    expect(paths('aberturas/a.mp4')).toEqual(['aberturas/a.mp4']);
  });
});
