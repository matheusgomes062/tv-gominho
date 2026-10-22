import { describe, expect, it } from 'vitest';
import type { Weekday } from './dates';
import { buildTimeline, planDay } from './engine';
import { generateSchedule, pickInterstitialRef, scheduleToYaml, yearRange } from './generate';
import { scanLibrary } from './library';
import { parseSchedule } from './schedule';
import { memorySource } from './test-helpers';
import type { LibraryWarning } from './types';

const FILES: Record<string, string> = {
  'programas/dbz/programa.yaml': 'titulo: DBZ',
  'programas/dbz/episodios/001.mp4': '',
  'programas/dbz/episodios/002.mp4': '',
  'programas/pinguins/programa.yaml': 'titulo: Pinguins',
  'programas/pinguins/episodios/001.mp4': '',
  'programas/pinguins/episodios/002.mp4': '',
  'programas/vazio/programa.yaml': 'titulo: Vazio',
  'vinhetas/aberturas/tv-globinho/Abertura (2003-2009).mp4': '',
  'vinhetas/aberturas/tv-globinho/Abertura (2009-2014).mp4': '',
  'vinhetas/aberturas/cartoon-network/abertura.mp4': '',
  'vinhetas/encerramentos/tv-globinho/Encerramento (2011).mp4': '',
  'vinhetas/chamadas/tv-globinho/chamada.mp4': '',
  'vinhetas/chamadas/jetix/chamada.mp4': '',
  'vinhetas/intervalos/tv-globinho/volta-ja.mp4': '',
  'vinhetas/intervalos/tv-globinho-2003-2009/entrada.mp4': '',
  'vinhetas/intervalos/tv-globinho-2003-2009/saida.mp4': '',
  'vinhetas/intervalos/cartoon-network/entrada.mp4': '',
  'vinhetas/comerciais/a.mp4': '',
  'vinhetas/comerciais/b.mp4': '',
  'vinhetas/comerciais/c.mp4': '',
};

const durationOf = (path: string) => (path.includes('/pinguins/') ? 11 * 60 : path.includes('/dbz/') ? 21 * 60 : path.includes('comerciais/') ? 30 : 10);

describe('yearRange', () => {
  it.each([
    ['Abertura (2003-2009).mp4', [2003, 2009]],
    ['tv-globinho-2009-2014', [2009, 2014]],
    ['Encerramento (2011)', [2011, 2011]],
    ['abertura.mp4', null],
    ['episodio 12345', null],
  ])('%s', (text, range) => expect(yearRange(text)).toEqual(range));
});

describe('pickInterstitialRef', () => {
  it('prefers the brand, then the file or folder of the era', async () => {
    const library = await scanLibrary(memorySource(FILES));
    expect(pickInterstitialRef(library, 'aberturas', 'globinho', 2004)).toBe('aberturas/tv-globinho/Abertura (2003-2009).mp4');
    expect(pickInterstitialRef(library, 'aberturas', 'globinho', 2012)).toBe('aberturas/tv-globinho/Abertura (2009-2014).mp4');
    expect(pickInterstitialRef(library, 'aberturas', 'globinho', undefined)).toBe('aberturas/tv-globinho');
    expect(pickInterstitialRef(library, 'intervalos', 'globinho', 2005)).toBe('intervalos/tv-globinho-2003-2009');
    expect(pickInterstitialRef(library, 'intervalos', 'globinho', undefined)).toBe('intervalos/tv-globinho');
    expect(pickInterstitialRef(library, 'chamadas', 'nickelodeon', undefined)).toBe('chamadas');
    expect(pickInterstitialRef(library, 'aberturas', '', undefined)).toBe('aberturas');
    expect(pickInterstitialRef(library, 'nada', 'globinho', undefined)).toBeNull();
  });
});

describe('generateSchedule', () => {
  it('fills a block with the shows in turn, framed by the era bumpers', async () => {
    const library = await scanLibrary(memorySource(FILES));
    const generated = generateSchedule(library, durationOf, {
      startDate: '2004-03-01',
      era: 2004,
      blocks: [{ start: 8 * 3600, length: 2 * 3600 }],
    });
    const { schedule, estimates } = generated;
    expect(schedule.breakBumpersRef).toBe('intervalos/tv-globinho-2003-2009');
    expect(schedule.days).toEqual(['seg', 'ter', 'qua', 'qui', 'sex']);
    const items = schedule.blocks[0]!.items;
    expect(items[0]).toEqual({ type: 'interstitial', ref: 'aberturas/tv-globinho/Abertura (2003-2009).mp4' });
    expect(items.at(-1)).toEqual({ type: 'interstitial', ref: 'encerramentos/tv-globinho/Encerramento (2011).mp4' });
    const shows = items.filter((item) => item.type === 'show');
    expect(shows.slice(0, 2)).toEqual(
      expect.arrayContaining([
        { type: 'show', show: 'dbz', count: 1 },
        { type: 'show', show: 'pinguins', count: 2 },
      ]),
    );
    // A promo between shows, never two shows in a row.
    items.forEach((item, i) => {
      if (item.type === 'show' && items[i + 1]?.type === 'show') throw new Error(`shows ${i} and ${i + 1} touch`);
    });
    expect(estimates[0]).toBeGreaterThan(1.75 * 3600);
    expect(estimates[0]).toBeLessThan(2.25 * 3600);

    // The estimate is close to what the engine really airs.
    const plan = planDay(schedule, library, '2004-03-01');
    const timeline = buildTimeline(plan, durationOf, { adBreaks: library.settings.adBreaks });
    expect(Math.abs(timeline.end - timeline.start - estimates[0]!)).toBeLessThan(10 * 60);
  });

  it('writes a grade file that reads back the same', async () => {
    const library = await scanLibrary(memorySource(FILES));
    const generated = generateSchedule(library, durationOf, {
      name: 'TV Globinho: "manhã"',
      startDate: '2010-03-01',
      era: 2010,
      blocks: [
        { start: 8 * 3600, length: 3600 },
        { start: 14 * 3600, length: 3600 },
      ],
    });
    const yaml = scheduleToYaml(generated, ['Gerada pelo teste']);
    expect(yaml.startsWith('# Gerada pelo teste\n')).toBe(true);
    const warnings: LibraryWarning[] = [];
    const parsed = parseSchedule('grades/tv-globinho.yaml', yaml, warnings);
    expect(warnings).toEqual([]);
    expect(parsed!.name).toBe('TV Globinho: "manhã"');
    expect(parsed!.blocks).toEqual(generated.schedule.blocks);
    expect(parsed!.breakBumpersRef).toBe(generated.schedule.breakBumpersRef);
    expect(parsed!.days).toEqual(generated.schedule.days);
  });

  it('leaves out shows made after the era', async () => {
    const files = { ...FILES, 'programas/pinguins/programa.yaml': 'titulo: Pinguins\nano: 2008' };
    const library = await scanLibrary(memorySource(files));
    const showsIn = (era: number) =>
      new Set(generateSchedule(library, durationOf, { era, startDate: '2004-03-01' }).schedule.blocks[0]!.items.flatMap((item) => (item.type === 'show' ? [item.show] : [])));
    expect([...showsIn(2004)]).toEqual(['dbz']);
    expect(showsIn(2010)).toEqual(new Set(['dbz', 'pinguins']));
  });

  it('takes the shows asked for, in that order, and keeps the turn across blocks', async () => {
    const library = await scanLibrary(memorySource(FILES));
    const { schedule } = generateSchedule(library, durationOf, {
      shows: ['pinguins', 'dbz'],
      startDate: '2004-03-01',
      blocks: [
        { start: 8 * 3600, length: 30 * 60 },
        { start: 9 * 3600, length: 30 * 60 },
      ],
    });
    const showsOf = (index: number) => schedule.blocks[index]!.items.flatMap((item) => (item.type === 'show' ? [item.show] : []));
    expect(showsOf(0)[0]).toBe('pinguins');
    expect(showsOf(1)[0]).toBe(showsOf(0).length % 2 === 0 ? 'pinguins' : 'dbz');
    expect(() => generateSchedule(library, durationOf, { shows: ['vazio'], startDate: '2004-03-01' })).toThrow();
    expect(() => generateSchedule(library, durationOf, { shows: ['nenhum'], startDate: '2004-03-01' })).toThrow('Não achei');
  });
});

describe('generateSchedule for the "Montar a semana" wizard', () => {
  const options = {
    name: 'Manhãs e tardes',
    shows: ['pinguins', 'dbz'],
    days: ['sex', 'seg', 'qua'] as Weekday[],
    startDate: '2026-03-02',
    blocks: [
      { start: 8 * 3600, length: 2 * 3600 },
      { start: 14 * 3600, length: 1 * 3600 },
      { start: 18 * 3600, length: 30 * 60 },
    ],
  };

  it('makes one block per time range, filled to its length, with only the shows asked for', async () => {
    const library = await scanLibrary(memorySource(FILES));
    const { schedule, estimates } = generateSchedule(library, durationOf, options);
    expect(schedule.blocks.map((block) => block.start)).toEqual([8 * 3600, 14 * 3600, 18 * 3600]);
    expect(schedule.name).toBe('Manhãs e tardes');
    const airing = schedule.blocks.flatMap((block) => block.items.flatMap((item) => (item.type === 'show' ? [item.show] : [])));
    expect(new Set(airing)).toEqual(new Set(['pinguins', 'dbz']));
    // The longer the range, the more it airs.
    expect(estimates[0]!).toBeGreaterThan(estimates[1]!);
    expect(estimates[1]!).toBeGreaterThan(estimates[2]!);
    expect(Math.abs(estimates[0]! - 2 * 3600)).toBeLessThan(15 * 60);
  });

  it('keeps the shows in the order given and the days it was told', async () => {
    const library = await scanLibrary(memorySource(FILES));
    const { schedule } = generateSchedule(library, durationOf, options);
    const first = schedule.blocks[0]!.items.find((item) => item.type === 'show');
    expect(first).toMatchObject({ show: 'pinguins' });
    expect(schedule.days).toEqual(['sex', 'seg', 'qua']);
  });

  it('writes a file that reads back with the same blocks, days and name', async () => {
    const library = await scanLibrary(memorySource(FILES));
    const generated = generateSchedule(library, durationOf, { ...options, days: ['seg', 'qua', 'sex'] });
    const warnings: LibraryWarning[] = [];
    const parsed = parseSchedule('grades/manhas-e-tardes.yaml', scheduleToYaml(generated), warnings);
    expect(warnings).toEqual([]);
    expect(parsed!.id).toBe('manhas-e-tardes');
    expect(parsed!.name).toBe('Manhãs e tardes');
    expect(parsed!.days).toEqual(['seg', 'qua', 'sex']);
    expect(parsed!.blocks).toEqual(generated.schedule.blocks);
  });
});
