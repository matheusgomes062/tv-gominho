// The "não passar" list (docs/biblioteca.md): shows and episodes that the dynamic mode never chooses by
// itself. An episode picked by hand in the agenda still airs. The engine asks `allowedEpisodes` for what
// it may choose from.

import { parse } from 'yaml';
import { findEpisodesByRef, normalizeEpisodeRef } from './agenda';
import { naturalCompare } from './paths';
import type { Blocklist, Library, LibraryWarning, Show } from './types';

/** Where the list lives: at the root of the library. */
export const BLOCKLIST_FILE = 'nao-passar.yaml';

export function emptyBlocklist(): Blocklist {
  return { shows: [], episodes: {} };
}

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/** The episodes (indices in `Show.episodes`) the list blocks. A reference without a season blocks every season's episode with that number. */
export function blockedEpisodes(library: Library, show: Show): Set<number> {
  const { shows, episodes } = library.blocklist;
  if (shows.some((id) => same(id, show.id))) return new Set(show.episodes.keys());
  const blocked = new Set<number>();
  for (const [id, refs] of Object.entries(episodes)) {
    if (!same(id, show.id)) continue;
    for (const ref of refs) for (const index of findEpisodesByRef(show, ref)) blocked.add(index);
  }
  return blocked;
}

/** The episodes the dynamic mode may choose, as ascending indices in `Show.episodes`: all of them without a list. */
export function allowedEpisodes(library: Library, show: Show): number[] {
  const blocked = blockedEpisodes(library, show);
  const allowed: number[] = [];
  show.episodes.forEach((_, index) => {
    if (!blocked.has(index)) allowed.push(index);
  });
  return allowed;
}

/**
 * Reads nao-passar.yaml:
 *   programas: [dragon-ball-z]
 *   episodios: { pica-pau: [3, "temporada-02/12"] }
 * A bad file or entry is reported and ignored, never fatal. Whether the entries exist in the library is
 * `validateBlocklist`'s job.
 */
export function parseBlocklist(path: string, text: string, warnings: LibraryWarning[]): Blocklist {
  const warn = (message: string) => warnings.push({ path, message });
  let value: unknown;
  try {
    value = parse(text);
  } catch (error) {
    warn(`Erro de sintaxe: ${(error as Error).message} A lista foi ignorada.`);
    return emptyBlocklist();
  }
  if (value === null || value === undefined) return emptyBlocklist();
  if (typeof value !== 'object' || Array.isArray(value)) {
    warn('O arquivo não está no formato esperado e foi ignorado. Use "programas" e "episodios".');
    return emptyBlocklist();
  }
  const root = value as Record<string, unknown>;
  for (const key of Object.keys(root)) {
    if (key !== 'programas' && key !== 'episodios') warn(`A chave "${key}" não é conhecida e foi ignorada. Use "programas" e "episodios".`);
  }

  const shows: string[] = [];
  if (root.programas !== undefined && root.programas !== null) {
    const list = Array.isArray(root.programas) ? root.programas : [root.programas];
    for (const entry of list) {
      const id = typeof entry === 'string' || typeof entry === 'number' ? String(entry).trim() : '';
      if (id) shows.push(id);
      else warn(`"programas" deve ser uma lista de nomes de pasta de programas, recebi ${JSON.stringify(entry)}. Esse item foi ignorado.`);
    }
  }

  const episodes: Record<string, string[]> = {};
  if (root.episodios !== undefined && root.episodios !== null) {
    if (typeof root.episodios !== 'object' || Array.isArray(root.episodios)) {
      warn('"episodios" deve ligar o nome da pasta de cada programa à lista de episódios, por exemplo "pica-pau: [3, 4]". Ele foi ignorado.');
    } else {
      for (const [id, entry] of Object.entries(root.episodios)) {
        for (const item of Array.isArray(entry) ? entry : [entry]) {
          const ref = normalizeEpisodeRef(item);
          if (ref) (episodes[id.trim()] ??= []).push(ref);
          else warn(`${id}: "${String(item)}" não é um episódio. Use o número (12) ou "temporada-02/12". Esse item foi ignorado.`);
        }
      }
    }
  }
  return normalizeBlocklist({ shows, episodes });
}

/** Sorted, without repeats (shows compared ignoring case, the first spelling wins). The one shape that parsing and writing agree on. */
function normalizeBlocklist(list: Blocklist): Blocklist {
  const keep = (names: string[]) => {
    const seen = new Set<string>();
    return names.filter((entry) => {
      if (seen.has(entry.toLowerCase())) return false;
      seen.add(entry.toLowerCase());
      return true;
    });
  };
  const shows = keep(list.shows).sort(naturalCompare);
  const episodes: Record<string, string[]> = {};
  for (const id of keep(Object.keys(list.episodes)).sort(naturalCompare)) {
    const refs = Object.entries(list.episodes)
      .filter(([other]) => same(other, id))
      .flatMap(([, entries]) => entries);
    episodes[id] = [...new Set(refs)].sort(naturalCompare);
  }
  return { shows, episodes };
}

/** Warns about entries that point at nothing in the library, and about references that block more than one episode. */
export function validateBlocklist(path: string, library: Library) {
  const list = library.blocklist;
  const warn = (message: string) => library.warnings.push({ path, message });
  const showOf = (id: string) => library.shows.find((show) => same(show.id, id));
  for (const id of list.shows) {
    if (!showOf(id)) warn(`"programas": o programa "${id}" não existe em programas/. Esse item foi ignorado.`);
  }
  for (const [id, refs] of Object.entries(list.episodes)) {
    const show = showOf(id);
    if (!show) {
      warn(`"episodios": o programa "${id}" não existe em programas/. Seus episódios foram ignorados.`);
      continue;
    }
    for (const ref of refs) {
      const found = findEpisodesByRef(show, ref);
      if (found.length === 0) warn(`"episodios": o programa "${show.id}" não tem o episódio ${ref}. Esse item foi ignorado.`);
      else if (found.length > 1) {
        warn(`"episodios": o programa "${show.id}" tem mais de um episódio ${ref} (temporadas), e todos ficaram de fora. Escreva a temporada, por exemplo "temporada-01/${ref}".`);
      }
    }
  }
}

const quote = (text: string) => JSON.stringify(text);
/** A name written bare when YAML reads it back as the same text, quoted otherwise. */
const bare = (text: string) => (/^[a-z][a-z0-9_-]*$/i.test(text) && !/^(?:true|false|null|yes|no|on|off|y|n)$/i.test(text) ? text : quote(text));
const ref = (text: string) => (/^\d+$/.test(text) ? text : quote(text));

/** The list as nao-passar.yaml, the way a person would write it; `parseBlocklist` reads it back to the same list. */
export function blocklistToYaml(list: Blocklist, header: string[] = []): string {
  const { shows, episodes } = normalizeBlocklist(list);
  const lines = header.map((line) => `# ${line}`);
  if (lines.length > 0) lines.push('');
  lines.push(`programas: [${shows.map(bare).join(', ')}]`);
  const entries = Object.entries(episodes).filter(([, refs]) => refs.length > 0);
  if (entries.length > 0) {
    lines.push('', 'episodios:');
    for (const [id, refs] of entries) lines.push(`  ${bare(id)}: [${refs.map(ref).join(', ')}]`);
  }
  return `${lines.join('\n')}\n`;
}
