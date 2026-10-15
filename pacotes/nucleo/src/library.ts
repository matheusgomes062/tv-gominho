import { parse } from 'yaml';
import {
  basename,
  extension,
  isConvertibleVideo,
  isImage,
  isPlayableVideo,
  isYaml,
  naturalCompare,
  parseEpisodeName,
  stripExtension,
  titleFromSlug,
} from './paths';
import { parseSchedule } from './schedule';
import { DEFAULT_SETTINGS, mergeSettings, parseSettings, type PartialSettings } from './settings';
import type {
  Episode,
  Interstitial,
  Library,
  LibrarySource,
  LibraryWarning,
  Schedule,
  Show,
} from './types';

const SECTIONS = ['programas', 'vinhetas', 'grades'];

interface ShowFiles {
  folder: string;
  programaYaml?: string;
  episodiosYaml?: string;
  poster?: string;
  backdrop?: string;
  logo?: string;
  videos: { path: string; season: string | null }[];
}

/** Reads the library folder structure described in docs/biblioteca.md. */
export async function scanLibrary(source: LibrarySource): Promise<Library> {
  const warnings: LibraryWarning[] = [];
  const root = findRoot(source.files);

  const showFiles = new Map<string, ShowFiles>();
  const interstitials: Interstitial[] = [];
  const schedulePaths: string[] = [];
  let settingsPath: string | undefined;

  for (const path of source.files) {
    if (!path.toLowerCase().startsWith(root.toLowerCase())) continue;
    const parts = path.slice(root.length).split('/');
    if (parts.some((part) => part.startsWith('.') || part === '')) continue;
    const section = parts[0]!.toLowerCase();

    if (isConvertibleVideo(path)) {
      warnings.push({
        path,
        message: `O formato .${extension(path)} ainda não é suportado. Converta o arquivo para MP4 (H.264 + AAC).`,
      });
      continue;
    }

    if (section === 'programas' && parts.length >= 3) {
      collectShowFile(showFiles, path, parts.slice(1));
    } else if (section === 'vinhetas' && isPlayableVideo(path)) {
      if (parts.length < 3) {
        warnings.push({ path, message: 'Vinheta fora de uma categoria. Coloque-a em uma pasta como vinhetas/intervalos/.' });
        continue;
      }
      interstitials.push({ path, category: parts[1]!.toLowerCase(), relativePath: parts.slice(1).join('/') });
    } else if (section === 'grades' && parts.length === 2 && isYaml(path)) {
      schedulePaths.push(path);
    } else if (parts.length === 1 && /^configuracoes\.ya?ml$/i.test(parts[0]!)) {
      settingsPath = path;
    }
  }

  if (!source.files.some((path) => SECTIONS.includes(path.slice(root.length).split('/')[0]!.toLowerCase()))) {
    warnings.push({
      message: 'Nenhuma pasta "programas", "vinhetas" ou "grades" encontrada. Escolha a pasta "biblioteca" (veja docs/biblioteca.md).',
    });
  }

  const shows: Show[] = [];
  for (const files of showFiles.values()) {
    const show = await buildShow(files, source, warnings);
    if (show) shows.push(show);
  }
  shows.sort((a, b) => naturalCompare(a.title, b.title));

  interstitials.sort((a, b) => naturalCompare(a.relativePath, b.relativePath));

  const schedules: Schedule[] = [];
  for (const path of schedulePaths.sort(naturalCompare)) {
    const schedule = parseSchedule(path, await source.readText(path), warnings);
    if (schedule) schedules.push(schedule);
  }

  const settingsFile: PartialSettings = settingsPath
    ? parseSettings(settingsPath, await source.readText(settingsPath), warnings)
    : {};
  const settings = mergeSettings(DEFAULT_SETTINGS, settingsFile);

  const library: Library = { root, shows, interstitials, schedules, settings, settingsFile, warnings };
  for (const schedule of schedules) validateReferences(schedule, library);
  return library;
}

/** The picked folder may be the library itself or a folder containing "biblioteca/" (e.g. a USB stick). */
function findRoot(files: readonly string[]): string {
  const hasSection = (prefix: string) =>
    files.some((path) => {
      const first = path.slice(prefix.length).split('/')[0]!.toLowerCase();
      return path.toLowerCase().startsWith(prefix.toLowerCase()) && SECTIONS.includes(first);
    });
  if (hasSection('')) return '';
  const nested = files.find((path) => path.toLowerCase().startsWith('biblioteca/'));
  if (nested && hasSection(nested.slice(0, 'biblioteca/'.length))) return nested.slice(0, 'biblioteca/'.length);
  return '';
}

function collectShowFile(showFiles: Map<string, ShowFiles>, path: string, parts: string[]) {
  const [folder, ...rest] = parts as [string, ...string[]];
  let files = showFiles.get(folder);
  if (!files) {
    files = { folder, videos: [] };
    showFiles.set(folder, files);
  }

  if (isPlayableVideo(path)) {
    // Videos anywhere in the show folder count as episodes; episodios/ is recommended.
    const dirs = rest.slice(0, -1);
    if (dirs[0]?.toLowerCase() === 'episodios') dirs.shift();
    files.videos.push({ path, season: dirs.length > 0 ? dirs.join('/') : null });
    return;
  }
  if (rest.length !== 1) return;

  const name = rest[0]!.toLowerCase();
  const stem = stripExtension(name);
  if (name === 'programa.yaml' || name === 'programa.yml') files.programaYaml = path;
  else if (name === 'episodios.yaml' || name === 'episodios.yml') files.episodiosYaml = path;
  else if (isImage(path) && stem === 'capa') files.poster = path;
  else if (isImage(path) && stem === 'fundo') files.backdrop = path;
  else if (isImage(path) && stem === 'logo') files.logo = path;
}

async function buildShow(files: ShowFiles, source: LibrarySource, warnings: LibraryWarning[]): Promise<Show | null> {
  const folderPath = files.videos[0]?.path ?? files.programaYaml ?? files.poster;
  if (files.videos.length === 0) {
    warnings.push({
      path: folderPath,
      message: `O programa "${files.folder}" não tem episódios em MP4 e foi ignorado.`,
    });
    return null;
  }

  const info = files.programaYaml ? await readYamlRecord(files.programaYaml, source, warnings) : {};
  if (!files.programaYaml) {
    warnings.push({
      path: folderPath,
      message: `O programa "${files.folder}" não tem programa.yaml. Usando o nome da pasta como título.`,
    });
  }
  const episodeInfo = files.episodiosYaml ? await readYamlRecord(files.episodiosYaml, source, warnings) : {};

  const episodes = files.videos.map(({ path, season }): Episode => {
    const parsed = parseEpisodeName(basename(path));
    const meta = findEpisodeInfo(episodeInfo, season, parsed.numberText);
    const title =
      (typeof meta.titulo === 'string' && meta.titulo) ||
      parsed.title ||
      (parsed.number !== null ? `Episódio ${parsed.number}` : stripExtension(basename(path)));
    return {
      path,
      number: parsed.number,
      title,
      description: typeof meta.descricao === 'string' ? meta.descricao : undefined,
      season,
      breaks: parseBreaks(meta.intervalos, path, files.episodiosYaml, warnings),
    };
  });
  episodes.sort(compareEpisodes);

  const order = info.ordem === 'aleatoria' || info.ordem === 'aleatória' ? 'aleatoria' : 'sequencial';
  const year = Number(info.ano);
  return {
    id: files.folder,
    title: typeof info.titulo === 'string' && info.titulo.trim() ? info.titulo.trim() : titleFromSlug(files.folder),
    originalTitle: typeof info.titulo_original === 'string' ? info.titulo_original : undefined,
    year: Number.isInteger(year) && year > 0 ? year : undefined,
    description: typeof info.descricao === 'string' ? info.descricao : undefined,
    rating: info.classificacao !== undefined ? String(info.classificacao) : undefined,
    order,
    poster: files.poster,
    backdrop: files.backdrop,
    logo: files.logo,
    episodes,
  };
}

/**
 * `intervalos: ["7:32", "14:10"]` in episodios.yaml: cut points as "mm:ss",
 * "h:mm:ss" or plain seconds. Bad points are dropped with a warning.
 */
function parseBreaks(
  value: unknown,
  episodePath: string,
  yamlPath: string | undefined,
  warnings: LibraryWarning[],
): number[] | undefined {
  if (value === undefined || value === null) return undefined;
  const warn = (message: string) => warnings.push({ path: yamlPath, message: `${basename(episodePath)}: ${message}` });
  const list = Array.isArray(value) ? value : [value];
  const points: number[] = [];
  for (const entry of list) {
    const seconds = parseClock(entry);
    if (seconds === undefined || seconds <= 0) {
      warn(`"intervalos" deve ter tempos como "7:32" (minutos:segundos) ou segundos, recebi ${JSON.stringify(entry)}. Esse ponto foi ignorado.`);
    } else points.push(seconds);
  }
  const sorted = [...new Set(points)].sort((a, b) => a - b);
  return sorted.length > 0 ? sorted : undefined;
}

/** "7:32", "1:07:32", "452" or the number 452 -> seconds. */
function parseClock(value: unknown): number | undefined {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value !== 'string') return undefined;
  const parts = value.trim().split(':');
  if (parts.length > 3 || parts.some((part) => !/^\d+(?:[.,]\d+)?$/.test(part.trim()))) return undefined;
  return parts.reduce((total, part) => total * 60 + Number(part.trim().replace(',', '.')), 0);
}

function compareEpisodes(a: Episode, b: Episode): number {
  const season = naturalCompare(a.season ?? '', b.season ?? '');
  if (season !== 0) return season;
  if (a.number !== null && b.number !== null && a.number !== b.number) return a.number - b.number;
  return naturalCompare(basename(a.path), basename(b.path));
}

function findEpisodeInfo(
  info: Record<string, unknown>,
  season: string | null,
  numberText: string | null,
): Record<string, unknown> {
  if (numberText === null) return {};
  const number = String(parseInt(numberText, 10));
  const keys = season ? [`${season}/${numberText}`, `${season}/${number}`] : [numberText, number];
  for (const key of keys) {
    const value = info[key];
    if (typeof value === 'object' && value !== null) return value as Record<string, unknown>;
  }
  return {};
}

async function readYamlRecord(
  path: string,
  source: LibrarySource,
  warnings: LibraryWarning[],
): Promise<Record<string, unknown>> {
  try {
    const value: unknown = parse(await source.readText(path));
    if (value === null || value === undefined) return {};
    if (typeof value !== 'object' || Array.isArray(value)) {
      warnings.push({ path, message: 'O arquivo não está no formato esperado e foi ignorado.' });
      return {};
    }
    // YAML may turn keys like 001 into numbers; normalize to strings.
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [String(key), entry]));
  } catch (error) {
    warnings.push({ path, message: `Erro de sintaxe: ${(error as Error).message}` });
    return {};
  }
}

/** Warns about schedule items that point to shows or bumpers that don't exist. */
function validateReferences(schedule: Schedule, library: Library) {
  if (schedule.breakBumpersRef !== undefined && resolveInterstitials(library, schedule.breakBumpersRef).length === 0) {
    library.warnings.push({
      path: schedule.path,
      message: `A grade usa "vinhetas_intervalo: ${schedule.breakBumpersRef}", que não existe em vinhetas/. Os intervalos usarão as vinhetas de vinhetas/intervalos/.`,
    });
  }
  const showIds = new Set(library.shows.map((show) => show.id.toLowerCase()));
  for (const block of schedule.blocks) {
    for (const item of block.items) {
      if (item.type === 'show' && !showIds.has(item.show.toLowerCase())) {
        library.warnings.push({
          path: schedule.path,
          message: `A grade usa o programa "${item.show}", que não existe em programas/. Ele será pulado.`,
        });
      } else if (item.type === 'interstitial' && resolveInterstitials(library, item.ref).length === 0) {
        library.warnings.push({
          path: schedule.path,
          message: `A grade usa a vinheta "${item.ref}", que não existe em vinhetas/. Ela será pulada.`,
        });
      }
    }
  }
}

export function findShow(library: Library, id: string): Show | undefined {
  const key = id.toLowerCase();
  return library.shows.find((show) => show.id.toLowerCase() === key);
}

/** "aberturas" (category), "aberturas/2003" (subfolder) or "aberturas/2003/a.mp4" (one file). */
export function resolveInterstitials(library: Library, ref: string): Interstitial[] {
  const key = ref.toLowerCase();
  if (isPlayableVideo(key)) {
    return library.interstitials.filter((item) => item.relativePath.toLowerCase() === key);
  }
  return library.interstitials.filter((item) => item.relativePath.toLowerCase().startsWith(`${key}/`));
}
