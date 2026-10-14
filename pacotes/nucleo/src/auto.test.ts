import { describe, expect, it } from 'vitest';
import { createShowChannels } from './auto';
import { planDay } from './engine';
import { scanLibrary } from './library';
import { memorySource } from './test-helpers';

const FILES: Record<string, string> = {
  'programas/dbz/programa.yaml': 'titulo: DBZ',
  'programas/dbz/episodios/001.mp4': '',
  'programas/dbz/episodios/002.mp4': '',
  'programas/dbz/episodios/003.mp4': '',
  'programas/bob/programa.yaml': 'titulo: Bob',
  'programas/bob/episodios/001.mp4': '',
  'programas/vazio/programa.yaml': 'titulo: Vazio',
};

const episodeNames = (plan: ReturnType<typeof planDay>) =>
  plan.blocks.flatMap((b) => b.items).flatMap((i) => (i.kind === 'episode' ? [i.episodeIndex] : []));

describe('createShowChannels', () => {
  it('builds one channel per show, skipping shows without episodes', async () => {
    const library = await scanLibrary(memorySource(FILES));
    const channels = createShowChannels(library);
    expect(channels.map((c) => c.name).sort()).toEqual(['Bob', 'DBZ']);
    expect(channels.map((c) => c.id).sort()).toEqual(['__programa:bob', '__programa:dbz']);
  });

  it('returns nothing for an empty library', async () => {
    expect(createShowChannels(await scanLibrary(memorySource({})))).toEqual([]);
  });

  it('loops through every episode of a short show each day', async () => {
    const library = await scanLibrary(memorySource(FILES));
    const dbz = createShowChannels(library).find((c) => c.id === '__programa:dbz')!;
    const day = episodeNames(planDay(dbz, library, '2024-05-01'));
    expect([...day].sort()).toEqual([0, 1, 2]);
    expect(day[1]).toBe((day[0]! + 1) % 3);
    expect(episodeNames(planDay(dbz, library, '2024-05-01'))).toEqual(day);
  });

  it('rotates long series across days', async () => {
    const files: Record<string, string> = { 'programas/longa/programa.yaml': 'titulo: Longa' };
    for (let i = 1; i <= 50; i++) files[`programas/longa/episodios/${String(i).padStart(3, '0')}.mp4`] = '';
    const library = await scanLibrary(memorySource(files));
    const [channel] = createShowChannels(library);
    const day1 = episodeNames(planDay(channel!, library, '2024-05-01'));
    const day2 = episodeNames(planDay(channel!, library, '2024-05-02'));
    expect(day1).toHaveLength(40);
    expect(day2[0]).toBe((day1[0]! + 40) % 50);
  });

  it('does not put "a seguir" bumpers between episodes: the commercial breaks do that', async () => {
    const library = await scanLibrary(memorySource({ ...FILES, 'vinhetas/intervalos/i1.mp4': '' }));
    const dbz = createShowChannels(library).find((c) => c.id === '__programa:dbz')!;
    const kinds = planDay(dbz, library, '2024-05-01').blocks[0]!.items.map((i) => i.kind);
    expect(kinds).toEqual(['episode', 'episode', 'episode']);
  });
});
