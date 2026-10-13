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
  const withTitle = /^(\d+)(?:\s*[-–—_.]\s*|\s+)(.*\S)\s*$/.exec(name);
  if (withTitle) {
    return { number: parseInt(withTitle[1]!, 10), numberText: withTitle[1]!, title: withTitle[2]! };
  }
  const onlyNumber = /^(\d+)$/.exec(name);
  if (onlyNumber) {
    return { number: parseInt(onlyNumber[1]!, 10), numberText: onlyNumber[1]!, title: null };
  }
  return { number: null, numberText: null, title: name };
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
