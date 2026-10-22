import { describe, expect, it } from 'vitest';
import { buildTimeline, planDay } from './engine';
import { generateSchedule, scheduleToYaml } from './generate';
import { scanLibrary } from './library';
import { parseSchedule } from './schedule';
import { channelAdBreaks } from './settings';
import { memorySource } from './test-helpers';
import type { LibraryWarning } from './types';

// The generator estimates with the channel's own break rules (docs/grade.md, "Intervalos por canal").

const FILES: Record<string, string> = {
  'programas/dbz/programa.yaml': 'titulo: DBZ',
  'programas/dbz/episodios/001.mp4': '',
  'programas/dbz/episodios/002.mp4': '',
  'programas/pinguins/programa.yaml': 'titulo: Pinguins',
  'programas/pinguins/episodios/001.mp4': '',
  'programas/pinguins/episodios/002.mp4': '',
  'vinhetas/aberturas/tv-globinho/abertura.mp4': '',
  'vinhetas/encerramentos/tv-globinho/encerramento.mp4': '',
  'vinhetas/intervalos/tv-globinho/entrada.mp4': '',
  'vinhetas/intervalos/tv-globinho/saida.mp4': '',
  'vinhetas/comerciais/a.mp4': '',
  'vinhetas/comerciais/b.mp4': '',
  'vinhetas/comerciais/c.mp4': '',
};

const durationOf = (path: string) => (path.includes('/episodios/') ? 22 * 60 : path.includes('comerciais/') ? 30 : 10);
const BLOCKS = [{ start: 8 * 3600, length: 2 * 3600 }];
const showCount = (blocks: { items: { type: string }[] }[]) => blocks[0]!.items.filter((item) => item.type === 'show').length;

describe('generateSchedule with the channel break rules', () => {
  it('estimates with the channel rules and writes them to the grade', async () => {
    const library = await scanLibrary(memorySource(FILES));
    const general = generateSchedule(library, durationOf, { startDate: '2004-03-01', blocks: BLOCKS });
    const own = generateSchedule(library, durationOf, { startDate: '2004-03-01', blocks: BLOCKS, adBreaks: { every: 0, ads: 1, afterEpisode: false } });

    expect(general.schedule.adBreaks).toBeUndefined();
    expect(own.schedule.adBreaks).toEqual({ every: 0, ads: 1, afterEpisode: false });
    // Fewer breaks per episode: more shows fit in the same two hours.
    expect(showCount(own.schedule.blocks)).toBeGreaterThan(showCount(general.schedule.blocks));

    // What the engine airs with the channel's rules is what was estimated; with the general rules it would be longer.
    const plan = planDay(own.schedule, library, '2004-03-01');
    const withOwn = buildTimeline(plan, durationOf, { adBreaks: channelAdBreaks(library.settings, own.schedule) });
    const withGeneral = buildTimeline(plan, durationOf, { adBreaks: library.settings.adBreaks });
    expect(Math.abs(withOwn.end - withOwn.start - own.estimates[0]!)).toBeLessThan(10 * 60);
    expect(withGeneral.end - withGeneral.start).toBeGreaterThan(withOwn.end - withOwn.start + 10 * 60);
  });

  it('writes only the rules given and reads them back, the rest following the general ones', async () => {
    const library = await scanLibrary(memorySource(FILES));
    const partial = generateSchedule(library, durationOf, { startDate: '2004-03-01', blocks: BLOCKS, adBreaks: { ads: 2 } });
    const general = generateSchedule(library, durationOf, { startDate: '2004-03-01', blocks: BLOCKS });
    expect(partial.schedule.adBreaks).toEqual({ ads: 2 });
    expect(scheduleToYaml(partial)).toContain('intervalos:\n  comerciais: 2\n');
    expect(scheduleToYaml(general)).not.toContain('intervalos:');

    const warnings: LibraryWarning[] = [];
    const parsed = parseSchedule('grades/x.yaml', scheduleToYaml(partial), warnings);
    expect(warnings).toEqual([]);
    expect(parsed!.adBreaks).toEqual({ ads: 2 });
    expect(channelAdBreaks(library.settings, parsed!)).toEqual({ ...library.settings.adBreaks, ads: 2 });
  });

  it('treats an empty set of rules as none', async () => {
    const library = await scanLibrary(memorySource(FILES));
    const generated = generateSchedule(library, durationOf, { startDate: '2004-03-01', blocks: BLOCKS, adBreaks: {} });
    expect(generated.schedule.adBreaks).toBeUndefined();
  });

  it('lets the general commercials switch win: a channel cannot turn them on', async () => {
    const library = await scanLibrary(memorySource(FILES));
    const off = { ...library.settings, commercials: false };
    const plain = generateSchedule(library, durationOf, { startDate: '2004-03-01', blocks: BLOCKS, settings: off });
    const own = generateSchedule(library, durationOf, { startDate: '2004-03-01', blocks: BLOCKS, settings: off, adBreaks: { every: 4, ads: 5 } });
    expect(own.estimates).toEqual(plain.estimates);
    expect(showCount(own.schedule.blocks)).toBeGreaterThan(showCount(generateSchedule(library, durationOf, { startDate: '2004-03-01', blocks: BLOCKS }).schedule.blocks));
  });

  it('estimates with the settings it is given instead of the library ones', async () => {
    const library = await scanLibrary(memorySource(FILES));
    const heavy = { ...library.settings, adBreaks: { ...library.settings.adBreaks, ads: 8 } };
    const withLibrary = generateSchedule(library, durationOf, { startDate: '2004-03-01', blocks: BLOCKS });
    const withHeavy = generateSchedule(library, durationOf, { startDate: '2004-03-01', blocks: BLOCKS, settings: heavy });
    expect(showCount(withHeavy.schedule.blocks)).toBeLessThanOrEqual(showCount(withLibrary.schedule.blocks));
  });
});
