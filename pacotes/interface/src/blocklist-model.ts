import {
  blockedEpisodes,
  blocklistToYaml,
  parseSchedule,
  positionsToYaml,
  preservePositions,
  type Blocklist,
  type Library,
  type LibraryWarning,
  type SavedPosition,
  type Schedule,
  type Show,
} from '@tv-gominho/nucleo';

// The model of the "Não passar" screen: which shows and episodes are blocked, how a toggle changes
// the list, and what saving has to write (the list, and the grades whose saved positions move with it).
// No React or DOM in here, so it is all testable (see blocklist-model.test.ts).

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/** The library as the engine would see it with `list` in place of the saved one. */
export function withBlocklist(library: Library, list: Blocklist): Library {
  return { ...library, blocklist: list };
}

/** A copy that can be changed without touching the library's own list. */
export function copyBlocklist(list: Blocklist): Blocklist {
  return { shows: [...list.shows], episodes: Object.fromEntries(Object.entries(list.episodes).map(([id, refs]) => [id, [...refs]])) };
}

/** Whether both lists are the same file once written. */
export function sameBlocklist(a: Blocklist, b: Blocklist): boolean {
  return blocklistToYaml(a) === blocklistToYaml(b);
}

/**
 * How `nao-passar.yaml` names an episode: its number, or "temporada-02/12" when the show repeats the number
 * in other seasons. Null for an episode without a number, which the list cannot name.
 */
export function episodeRef(show: Show, index: number): string | null {
  const episode = show.episodes[index];
  if (!episode || episode.number === null) return null;
  const repeats = show.episodes.some((other, i) => i !== index && other.number === episode.number);
  if (!repeats) return String(episode.number);
  return episode.season ? `${episode.season}/${episode.number}` : null;
}

export function isEpisodeBlocked(library: Library, list: Blocklist, show: Show, index: number): boolean {
  return blockedEpisodes(withBlocklist(library, list), show).has(index);
}

export type BlockState = 'none' | 'some' | 'all';

export interface ShowStatus {
  state: BlockState;
  blocked: number;
  total: number;
}

export function showStatus(library: Library, list: Blocklist, show: Show): ShowStatus {
  const blocked = blockedEpisodes(withBlocklist(library, list), show).size;
  const total = show.episodes.length;
  return { state: blocked === 0 ? 'none' : blocked === total ? 'all' : 'some', blocked, total };
}

/** Takes every entry of the show out of the list (any spelling of its folder name). */
function without(list: Blocklist, show: Show): Blocklist {
  const episodes: Record<string, string[]> = {};
  for (const [id, refs] of Object.entries(list.episodes)) if (!same(id, show.id)) episodes[id] = refs;
  return { shows: list.shows.filter((id) => !same(id, show.id)), episodes };
}

/** A show with every episode blocked is released; any other state blocks the show whole. */
export function toggleShow(library: Library, list: Blocklist, show: Show): Blocklist {
  const rest = without(list, show);
  if (showStatus(library, list, show).state === 'all') return rest;
  return { ...rest, shows: [...rest.shows, show.id] };
}

/** Whether the episode can be named in the list (see `episodeRef`). */
export function canBlockEpisode(show: Show, index: number): boolean {
  return episodeRef(show, index) !== null;
}

/**
 * Blocks or releases one episode. A show that was blocked whole turns into the list of its other episodes.
 * Episodes the list cannot name (no number) are not kept in that case.
 */
export function toggleEpisode(library: Library, list: Blocklist, show: Show, index: number): Blocklist {
  if (!canBlockEpisode(show, index)) return list;
  const blocked = blockedEpisodes(withBlocklist(library, list), show);
  if (blocked.has(index)) blocked.delete(index);
  else blocked.add(index);
  const refs = [...blocked].flatMap((i) => episodeRef(show, i) ?? []);
  const rest = without(list, show);
  return refs.length === 0 ? rest : { ...rest, episodes: { ...rest.episodes, [show.id]: refs } };
}

export interface BlockSummary {
  shows: number;
  episodes: number;
}

/** What the list holds, for the header: shows blocked whole, and other episodes blocked one by one. */
export function summarize(library: Library, list: Blocklist): BlockSummary {
  let shows = 0;
  let episodes = 0;
  for (const show of library.shows) {
    const status = showStatus(library, list, show);
    if (status.state === 'all' && show.episodes.length > 0) shows++;
    else episodes += status.blocked;
  }
  return { shows, episodes };
}

/** The list as nao-passar.yaml. */
export const BLOCKLIST_HEADER = ['Programas e episódios que o modo dinâmico nunca escolhe sozinho (veja docs/biblioteca.md).'];

export function blocklistText(list: Blocklist): string {
  return blocklistToYaml(list, BLOCKLIST_HEADER);
}

/**
 * `text` (a grade file) with its `posicoes` section replaced by `positions`; everything else, comments
 * included, stays as it was. The section ends at the next line that starts a key or a comment in column 0.
 */
export function replacePositions(text: string, positions: readonly SavedPosition[] | undefined): string {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const start = lines.findIndex((line) => /^posicoes\s*:/.test(line));
  let kept = lines;
  let tail: string[] = [];
  if (start >= 0) {
    let end = start + 1;
    while (end < lines.length && (lines[end] === '' || /^\s/.test(lines[end]!))) end++;
    kept = lines.slice(0, start);
    tail = lines.slice(end);
  }
  while (kept.length > 0 && kept.at(-1)!.trim() === '') kept.pop();
  const section = positionsToYaml(positions);
  const result = [...kept, ...section, ...(tail.length > 0 ? ['', ...tail] : [])];
  while (result.length > 0 && result.at(-1)!.trim() === '') result.pop();
  return `${result.join('\n')}\n`;
}

/** A grade file that has to be written again because its saved positions changed. */
export interface GradeUpdate {
  path: string;
  /** File name, e.g. "manha.yaml". */
  name: string;
  text: string;
}

export interface SavePlan {
  list: { path: string; name: string; text: string };
  grades: GradeUpdate[];
  /** Grades that could not be prepared (the whole save then does not start). */
  problems: Array<{ path: string; message: string }>;
}

/** The shows (ids, lowercase) whose blocked episodes differ between the saved list and `list`. */
export function changedShows(library: Library, list: Blocklist): Set<string> {
  const now = withBlocklist(library, list);
  const changed = new Set<string>();
  for (const show of library.shows) {
    const before = blockedEpisodes(library, show);
    const after = blockedEpisodes(now, show);
    if (before.size !== after.size || [...before].some((index) => !after.has(index))) changed.add(show.id.toLowerCase());
  }
  return changed;
}

const positionKey = (positions: readonly SavedPosition[] | undefined) => positionsToYaml(positions).join('\n');

/**
 * What saving writes. Changing the list shifts the episode count of the shows (the sequence only counts
 * allowed episodes), so every grade gets the position each show stood on `today` under the old list
 * (`preservePositions(grade, grade, newLibrary, today, oldLibrary)`), and only the grades where that changes
 * something are rewritten. `gradeTexts` maps each grade's path to its file text; only the `posicoes` section
 * of it is touched. Grades come first in the order of writing, the list last (see `saveFiles`).
 */
export function buildSavePlan(
  library: Library,
  list: Blocklist,
  today: string,
  listPath: string,
  gradeTexts: ReadonlyMap<string, string>,
): SavePlan {
  const newLibrary = withBlocklist(library, list);
  const changed = changedShows(library, list);
  const grades: GradeUpdate[] = [];
  const problems: SavePlan['problems'] = [];
  for (const schedule of library.schedules) {
    const text = gradeTexts.get(schedule.path);
    if (text === undefined) {
      problems.push({ path: schedule.path, message: 'Não consegui ler esta grade.' });
      continue;
    }
    // A grade without a show whose blocked episodes changed airs the same either way.
    if (!schedule.blocks.some((block) => block.items.some((item) => item.type === 'show' && changed.has(item.show.toLowerCase())))) continue;
    let updated: Schedule;
    try {
      updated = preservePositions(schedule, schedule, newLibrary, today, library);
    } catch (error) {
      problems.push({ path: schedule.path, message: (error as Error).message });
      continue;
    }
    if (positionKey(updated.positions) === positionKey(schedule.positions)) continue;
    const patched = replacePositions(text, updated.positions);
    // What is written must read back as the positions worked out; otherwise this grade is left alone and reported.
    const warnings: LibraryWarning[] = [];
    const check = parseSchedule(schedule.path, patched, warnings);
    if (!check || positionKey(check.positions) !== positionKey(updated.positions)) {
      problems.push({ path: schedule.path, message: 'Não deu para atualizar as posições desta grade sem estragá-la.' });
      continue;
    }
    grades.push({ path: schedule.path, name: schedule.path.slice(schedule.path.lastIndexOf('/') + 1), text: patched });
  }
  return {
    list: { path: listPath, name: listPath.slice(listPath.lastIndexOf('/') + 1), text: blocklistText(list) },
    grades,
    problems,
  };
}

/** Where nao-passar.yaml is (or goes): the existing file in the list of files, whatever its case, or the root of the library. */
export function blocklistPath(files: readonly string[], root: string): string {
  const wanted = `${root}nao-passar.yaml`.toLowerCase();
  return files.find((file) => file.toLowerCase() === wanted) ?? `${root}nao-passar.yaml`;
}
