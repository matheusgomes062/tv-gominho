// Asks Jev about every downloaded file, in as few tokens as the answers allow
// (see questions.ts): the show once per folder, roles in batches, the show per file
// only in folders that mix shows, the station only for station clips.

import { isChoice, isNoul, type ChoiceAnswer, type JevClient } from '../jev/client';
import { BRANDED_ROLES, brandsRequest, chunks, folderRequest, rolesRequest, showRequest, type Role } from './questions';
import type { ClassifiedFile } from './plan';

/** Below this, a folder's episodes are taken as coming from several shows. */
const SAME_SHOW = 0.5;
const CONCURRENCY = 4;

const folderOf = (path: string) => (path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '');
const nameOf = (path: string) => path.slice(path.lastIndexOf('/') + 1);

/** Runs `task` on every item, at most `limit` at a time, keeping the order of the results. */
export async function pool<T, R>(items: readonly T[], limit: number, task: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await task(items[index]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

function choice(answers: Record<string, unknown>, key: string): ChoiceAnswer {
  const answer = answers[key] as Parameters<typeof isChoice>[0];
  if (!isChoice(answer)) throw new Error(`O Jev não respondeu "${key}".`);
  return answer;
}

/** Every file (paths inside the download folder) with Jev's answers. */
export async function classifyFiles(paths: readonly string[], jev: JevClient, onProgress?: (done: number, total: number) => void): Promise<ClassifiedFile[]> {
  const folders = new Map<string, string[]>();
  for (const path of paths) folders.set(folderOf(path), [...(folders.get(folderOf(path)) ?? []), path]);

  // Roles first: the show question then sees only the episodes (no samples, no vinhetas)
  // and is skipped for folders without any.
  const batches = [...folders].flatMap(([folder, files]) => chunks(files).map((batch) => ({ folder, files: batch })));
  const roles = new Map<string, ChoiceAnswer>();
  let done = 0;
  await pool(batches, CONCURRENCY, async ({ folder, files }) => {
    const { answers } = await jev.ask(rolesRequest(folder, files.map(nameOf)));
    files.forEach((file, i) => roles.set(file, choice(answers, `papel_${i}`)));
    done += files.length;
    onProgress?.(done, paths.length);
  });

  const results: ClassifiedFile[] = paths.map((path) => ({ path, role: roles.get(path)! }));
  const episodes = results.filter((file) => (file.role.choice as Role) === 'episodio');

  const episodeFolders = new Map<string, string[]>();
  for (const file of episodes) episodeFolders.set(folderOf(file.path), [...(episodeFolders.get(folderOf(file.path)) ?? []), nameOf(file.path)]);
  const folderShow = new Map<string, { show: ChoiceAnswer; mixed: boolean }>();
  await pool([...episodeFolders], CONCURRENCY, async ([folder, names]) => {
    const { answers } = await jev.ask(folderRequest(folder, names));
    const same = answers.mesmo;
    folderShow.set(folder, { show: choice(answers, 'programa'), mixed: !isNoul(same) || same.noul < SAME_SHOW });
  });

  // Shows: the folder's answer, or one question per file where the folder mixes shows.
  await pool(episodes, CONCURRENCY, async (file) => {
    const folder = folderShow.get(folderOf(file.path))!;
    if (!folder.mixed) {
      file.show = folder.show;
      return;
    }
    file.show = choice((await jev.ask(showRequest(file.path))).answers, 'programa');
    file.mixedFolder = true;
  });

  // Stations, for the clips that need one.
  const clips = results.filter((file) => BRANDED_ROLES.has(file.role.choice as Role));
  await pool(chunks(clips), CONCURRENCY, async (batch) => {
    const { answers } = await jev.ask(brandsRequest(batch.map((file) => file.path)));
    batch.forEach((file, i) => (file.brand = choice(answers, `marca_${i}`)));
  });
  return results;
}
