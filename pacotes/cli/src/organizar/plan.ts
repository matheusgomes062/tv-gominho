// Turns Jev's answers about each downloaded file into a place in the library
// (docs/biblioteca.md). Pure: no files, no network, so every rule is tested.
// Jev only picks among known options (a show of the list, a role, a station);
// the paths are always built here.

import { bumperRole, type BumperRole } from '@tv-gominho/nucleo';
import type { ChoiceAnswer } from '../jev/client';
import { BRANDED_ROLES, BRANDS, LISTED_SHOWS, OTHER_SHOW, ROLES, slugify, type Role } from './questions';

export interface Thresholds {
  /** Below this confidence the role is a guess: the file waits for a person. */
  role: number;
  show: number;
  brand: number;
}

/**
 * Chosen on the evaluation set (avaliacao.test.ts): the wrong guesses of earlier question
 * wordings ("A Volta de Goku" as a vinheta, 0.44; "globinho 2010 vinheta" as an abertura,
 * 0.59) fall below them. With the current wording no answer is wrong, and only one right
 * answer is held for review ("Novos/A Volta de Goku.avi": Dragon Ball Z at 0.65, a fair
 * doubt, since nothing in the name says which Dragon Ball).
 */
export const DEFAULT_THRESHOLDS: Thresholds = { role: 0.65, show: 0.7, brand: 0.6 };

export interface ClassifiedFile {
  /** Path inside the download folder, '/'-separated. */
  path: string;
  role: ChoiceAnswer;
  /** The episode's show (episodes only). */
  show?: ChoiceAnswer;
  /** True when the show came from the file alone because its folder mixes shows. */
  mixedFolder?: boolean;
  /** The station (station clips only). */
  brand?: ChoiceAnswer;
}

export type PlanEntry =
  | { status: 'mover'; from: string; to: string; role: Role; show?: string }
  | { status: 'revisar'; from: string; reason: string }
  | { status: 'deixar'; from: string; role: Role }
  | { status: 'existe'; from: string; to: string };

export interface Plan {
  entries: PlanEntry[];
  /** Shows of the list that get a new folder: write their programa.yaml. */
  newShows: { slug: string; title: string; originalTitle?: string }[];
}

const CATEGORY: Partial<Record<Role, string>> = {
  abertura: 'vinhetas/aberturas',
  encerramento: 'vinhetas/encerramentos',
  comercial: 'vinhetas/comerciais',
  chamada: 'vinhetas/chamadas',
};

const BUMPER_ROLE: Partial<Record<Role, BumperRole>> = { intervalo_entrada: 'entry', intervalo_saida: 'exit', intervalo_generico: 'any' };

const basename = (path: string) => path.slice(path.lastIndexOf('/') + 1);
const folderOf = (path: string) => (path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '');
const percent = (value: number) => `${Math.round(value * 100)}%`;

/** "1x05", "S02E03", or a folder "T02" / "Temporada 2" / "Season 2": the season number, or null. */
export function seasonOf(path: string): number | null {
  const name = basename(path);
  const fromName = /(?:^|[^a-z0-9])s(\d{1,2})[\s._-]*e\d/i.exec(name) ?? /(?:^|[^a-z0-9])(\d{1,2})x\d{1,3}(?![0-9])/i.exec(name);
  if (fromName) return Number(fromName[1]);
  const folder = basename(folderOf(path));
  const fromFolder = /^(?:t|temporada|season|temp)[\s._-]*(\d{1,2})$/i.exec(folder) ?? /(?:^|[\s._-])(?:t|temporada|season)[\s._-]*(\d{1,2})$/i.exec(folder);
  return fromFolder ? Number(fromFolder[1]) : null;
}

/** The two likeliest options, for a person to decide: "abertura 48% ou intervalo_generico 41%". */
export function topTwo(answer: ChoiceAnswer): string {
  return Object.entries(answer.probabilities)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2)
    .map(([option, p]) => `${option} ${percent(p)}`)
    .join(' ou ');
}

/** A bumper's file name that says its role the way the app reads it (`entrada`/`saida`, see bumperRole). */
export function bumperName(name: string, role: BumperRole): string | null {
  if (bumperRole(name) === role) return name;
  const renamed = role === 'entry' ? `entrada - ${name}` : role === 'exit' ? `saida - ${name}` : null;
  return renamed && bumperRole(renamed) === role ? renamed : null;
}

/** Where each file goes. `exists` says whether a library path is already taken. */
export function planOrganize(files: readonly ClassifiedFile[], exists: (libraryPath: string) => boolean, thresholds = DEFAULT_THRESHOLDS): Plan {
  const entries: PlanEntry[] = [];
  const taken = new Set<string>();
  const newShows = new Map<string, Plan['newShows'][number]>();

  for (const file of files) {
    const review = (reason: string) => entries.push({ status: 'revisar', from: file.path, reason });
    // Answers become path parts, and the cache they come from sits in the downloads folder: only
    // options the questions offered are accepted.
    const unexpected = () => review('resposta inesperada do Jev; confira este arquivo à mão');
    if (!ROLES.has(file.role.choice)) {
      unexpected();
      continue;
    }
    const role = file.role.choice as Role;
    if (file.role.confidence < thresholds.role) {
      review(`não sei o que é: ${topTwo(file.role)}`);
      continue;
    }
    if (role === 'filme' || role === 'extra') {
      entries.push({ status: 'deixar', from: file.path, role });
      continue;
    }

    let to: string;
    let show: string | undefined;
    const name = basename(file.path);
    if (role === 'episodio') {
      if (!file.show || file.show.confidence < thresholds.show) {
        review(file.show ? `não sei de qual programa é: ${topTwo(file.show)}` : 'não sei de qual programa é');
        continue;
      }
      if (file.show.choice === OTHER_SHOW) {
        // Not in the TV Globinho list: the folder names the show, unless it holds several.
        const folder = basename(folderOf(file.path));
        show = slugify(folder);
        if (!folder || file.mixedFolder || !show) {
          review('programa fora da lista da TV Globinho; ponha o arquivo numa pasta com o nome do programa');
          continue;
        }
      } else {
        const listed = LISTED_SHOWS.find((candidate) => candidate.slug === file.show!.choice);
        if (!listed) {
          unexpected();
          continue;
        }
        show = listed.slug;
        if (!exists(`programas/${show}`)) newShows.set(show, listed);
      }
      const season = seasonOf(file.path);
      to = `programas/${show}/episodios/${season !== null ? `temporada-${String(season).padStart(2, '0')}/` : ''}${name}`;
    } else {
      let brand: string | undefined;
      if (BRANDED_ROLES.has(role)) {
        if (!file.brand || file.brand.confidence < thresholds.brand) {
          review(file.brand ? `não sei de qual emissora é: ${topTwo(file.brand)}` : 'não sei de qual emissora é');
          continue;
        }
        if (!Object.hasOwn(BRANDS, file.brand.choice)) {
          unexpected();
          continue;
        }
        brand = file.brand.choice;
      }
      const bumper = BUMPER_ROLE[role];
      if (bumper) {
        const renamed = bumperName(name, bumper);
        if (!renamed) {
          review(`o nome diz "entrada" ou "saída" ao contrário do que a vinheta parece ser (${role})`);
          continue;
        }
        to = `vinhetas/intervalos/${brand}/${renamed}`;
      } else {
        // Openings and closings go under the station, so `grade --marca` finds them; "outra" stays loose.
        to = `${CATEGORY[role]}/${brand && brand !== 'outra' ? `${brand}/` : ''}${name}`;
      }
    }

    const key = to.toLowerCase();
    if (exists(to)) entries.push({ status: 'existe', from: file.path, to });
    else if (taken.has(key)) review(`outro arquivo já vai para ${to}`);
    else {
      taken.add(key);
      entries.push({ status: 'mover', from: file.path, to, role, ...(show ? { show } : {}) });
    }
  }
  return { entries, newShows: [...newShows.values()] };
}
