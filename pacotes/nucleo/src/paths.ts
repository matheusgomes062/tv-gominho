// Path and file-name helpers. Library paths always use '/' separators.

const collator = new Intl.Collator('pt-BR', { numeric: true, sensitivity: 'base' });

/** Natural sort: "2" comes before "10", case and accents ignored. */
export function naturalCompare(a: string, b: string): number {
  return collator.compare(a, b);
}

export function basename(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}

export function dirname(path: string): string {
  const i = path.lastIndexOf('/');
  return i < 0 ? '' : path.slice(0, i);
}

export function stripExtension(name: string): string {
  const i = name.lastIndexOf('.');
  return i > 0 ? name.slice(0, i) : name;
}

export function extension(path: string): string {
  const name = basename(path);
  const i = name.lastIndexOf('.');
  return i > 0 ? name.slice(i + 1).toLowerCase() : '';
}

/** Video formats every target can play (browser, Android WebView). */
export const PLAYABLE_VIDEO = new Set(['mp4', 'm4v', 'webm', 'mov']);

/** Video formats that need converting to MP4 first. */
export const CONVERTIBLE_VIDEO = new Set([
  'avi', 'mkv', 'wmv', 'rmvb', 'rm', 'flv', 'mpg', 'mpeg', 'vob', '3gp', 'ts', 'divx', 'ogv', 'asf',
]);

export const IMAGE = new Set(['jpg', 'jpeg', 'png', 'webp']);

export const isPlayableVideo = (path: string) => PLAYABLE_VIDEO.has(extension(path));
export const isConvertibleVideo = (path: string) => CONVERTIBLE_VIDEO.has(extension(path));
export const isImage = (path: string) => IMAGE.has(extension(path));
export const isYaml = (path: string) => ['yaml', 'yml'].includes(extension(path));

export interface ParsedEpisodeName {
  number: number | null;
  /** The number exactly as written in the file name, e.g. "001". */
  numberText: string | null;
  title: string | null;
}

/** "001 - A Volta de Goku.mp4" -> { number: 1, numberText: "001", title: "A Volta de Goku" } */
export function parseEpisodeName(fileName: string): ParsedEpisodeName {
  const name = stripExtension(fileName).trim();
  const found = (numberText: string, title: string | undefined): ParsedEpisodeName => ({
    number: parseInt(numberText, 10),
    numberText,
    title: cleanTitle(title),
  });
  // "1x01 - Título" or "S01E01 - Título": the season comes from the folder, the number is the episode.
  const seasonFirst = /^(?:\d+x|s\d+\s*e)(\d+)(?:\s*[-–—_.]\s*|\s+|$)(.*)$/i.exec(name);
  if (seasonFirst) return found(seasonFirst[1]!, seasonFirst[2]);
  const withTitle = /^(\d+)(?:\s*[-–—_.]\s*|\s+)(.*\S)\s*$/.exec(name);
  if (withTitle) return found(withTitle[1]!, withTitle[2]);
  const onlyNumber = /^(\d+)$/.exec(name);
  if (onlyNumber) return found(onlyNumber[1]!, undefined);
  // Downloaded files: "DBZ_Episodio 001_WwW.Site.Biz", "Show - S02E05 - Título", "Show 1x05".
  const inside = /(?:^|[\s._-])(?:s\d+\s*e|\d+x|epis[oó]dio|ep|cap[ií]tulo)[\s._-]*(\d+)(?=$|[\s._-])(.*)$/i.exec(name);
  if (inside) return found(inside[1]!, inside[2]);
  return { number: null, numberText: null, title: name };
}

/** Site tags left by downloads ("WwW.TheRebels.Biz.By.Coelho") are not titles. */
const SITE_TAG = /\bwww\.|https?:|\.(?:com|net|org|biz|info)\b/i;

function cleanTitle(text: string | undefined): string | null {
  const title = (text ?? '').replace(/^[\s._–—-]+|[\s._–—-]+$/g, '');
  if (!title || SITE_TAG.test(title)) return null;
  return /\s/.test(title) ? title : title.replace(/_/g, ' ');
}

/** "dragon-ball-z" -> "Dragon Ball Z" */
export function titleFromSlug(slug: string): string {
  return slug
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((word) => word[0]!.toUpperCase() + word.slice(1))
    .join(' ');
}

/** Lowercase and strip accents, for forgiving comparisons ("Sáb" == "sab"). */
export function fold(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}
