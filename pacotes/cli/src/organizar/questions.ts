// The questions `organizar` asks Jev. Shaped and measured on a set of real-looking
// download names (Dragon Ball / Z / GT, the three Spider-Man shows, "A Volta de Goku",
// vinhetas, movies, samples):
//   - The show is a Choice over the whole TV Globinho list plus "outro"; a shortlist or a
//     separate yes/no question did no better and cost more.
//   - It is asked once per folder (with a sample of names); per file only when the
//     folder mixes shows.
//   - Roles are asked 20 files per request: the list of roles is small, so batching
//     costs ~640 tokens per file instead of ~3,300 for everything per file.
//   - Structured criteria (what it is / what it is not) fixed episodes named like
//     vinhetas ("A Volta de Goku") and theme songs taken for the channel's opening.

import programas from '../../../../docs/programas-tv-globinho.json';
import type { JevRequest, Question } from '../jev/client';

export interface ListedShow {
  slug: string;
  title: string;
  originalTitle?: string;
}

/** Folder name for a title: "Yu-Gi-Oh! GX" -> "yu-gi-oh-gx", "Digimon (Digimon Adventure)" -> "digimon". */
export function slugify(text: string): string {
  return text
    .replace(/\(.*?\)/g, '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

const known = (text: string | undefined) => (text && !/a confirmar/i.test(text) ? text : undefined);

/** The shows TV Globinho aired (docs/programas-tv-globinho.json). */
export const LISTED_SHOWS: ListedShow[] = (programas as { titulo: string; titulo_original?: string }[]).map((show) => ({
  slug: slugify(show.titulo),
  title: show.titulo,
  ...(known(show.titulo_original) ? { originalTitle: show.titulo_original } : {}),
}));

export const OTHER_SHOW = 'outro';

const SHOW_CRITERIA: Record<string, string> = {
  ...Object.fromEntries(LISTED_SHOWS.map((show) => [show.slug, [show.title, show.originalTitle].filter(Boolean).join(' / ')])),
  [OTHER_SHOW]: 'Um programa que não está nesta lista.',
};

export type Role =
  | 'episodio'
  | 'filme'
  | 'abertura'
  | 'encerramento'
  | 'intervalo_entrada'
  | 'intervalo_saida'
  | 'intervalo_generico'
  | 'comercial'
  | 'chamada'
  | 'extra';

const BUMPER = 'Vinheta curta (segundos) com a marca de uma emissora ou do programa infantil, não de um desenho.';

const ROLE_CRITERIA: Record<Role, unknown> = {
  episodio: {
    e: 'Um episódio de um desenho, anime ou série. Costuma ter número (001, 1x05, S02E03, ep 12) ou o título do episódio.',
    atencao: 'Títulos de episódio podem ter palavras como "volta", "abertura" ou "chamada" ("A Volta de Goku"); isso não faz deles vinhetas.',
  },
  filme: { e: 'Um filme longa-metragem, inclusive filmes de um desenho.', nao_e: 'Um episódio de série.' },
  abertura: { e: 'Vinheta que abre o programa infantil da emissora (ex.: abertura da TV Globinho).', nao_e: 'A música de abertura de um desenho (isso é extra).' },
  encerramento: { e: 'Vinheta que fecha o programa infantil da emissora (ex.: encerramento da TV Globinho, "tchau").' },
  intervalo_entrada: { e: `${BUMPER} Indo para o intervalo comercial: "volta já", "já voltamos", "a seguir", "we'll be right back", "after the break".` },
  intervalo_saida: { e: `${BUMPER} Voltando do intervalo: "estamos de volta", "de volta ao desenho", "back to the show".` },
  intervalo_generico: { e: `${BUMPER} Sem dizer se é ida ou volta do intervalo, nem abertura ou encerramento: só "vinheta" ou "bumper".` },
  comercial: 'Comercial ou propaganda de um produto.',
  chamada: 'Chamada de programação: anuncia um programa ou filme que vai passar.',
  extra: 'Material que não vai ao ar no canal: amostra (sample), making of, trailer, música de abertura de um desenho, bastidores.',
};

/** Subfolders of vinhetas/intervalos/ (docs/biblioteca.md); "outra" when no brand is clear. */
export const BRANDS: Record<string, string> = {
  'tv-globinho': 'TV Globinho ou Rede Globo',
  'cartoon-network': 'Cartoon Network (CN)',
  'disney-channel': 'Disney Channel ou Disney',
  jetix: 'Jetix ou Fox Kids',
  nickelodeon: 'Nickelodeon (Nick)',
  sbt: 'SBT, Bom Dia & Cia, Sábado Animado',
  outra: 'Outra emissora, ou nenhuma identificável',
};

/** Roles of short station clips, the ones a brand is asked for. */
export const BRANDED_ROLES: ReadonlySet<Role> = new Set(['abertura', 'encerramento', 'intervalo_entrada', 'intervalo_saida', 'intervalo_generico']);

/** How many files one request asks about. */
export const BATCH = 20;

/** Up to `count` names spread over the folder (first, middle, last...), for the folder question. */
export function sampleNames(names: readonly string[], count = 12): string[] {
  if (names.length <= count) return [...names];
  return Array.from({ length: count }, (_, i) => names[Math.round((i * (names.length - 1)) / (count - 1))]!);
}

/** The show of a folder's episodes, and whether they are all of one show. */
export function folderRequest(folder: string, names: readonly string[]): JevRequest {
  const ignore = 'Ignore vinhetas, comerciais, filmes e extras.';
  return {
    state: { pasta: folder, arquivos: sampleNames(names) },
    questions: {
      programa: {
        type: 'choice',
        instructions: `Os episódios de desenho em \`arquivos\` (vídeos baixados, guardados na pasta \`pasta\`) são de qual programa? ${ignore}`,
        criteria: SHOW_CRITERIA,
      },
      mesmo: { type: 'noul', instructions: `Todos os episódios de desenho em \`arquivos\` são do mesmo programa? ${ignore}` },
    },
  };
}

/** The show of one file, for folders that mix shows. */
export function showRequest(file: string): JevRequest {
  return {
    state: { arquivo: file },
    questions: {
      programa: { type: 'choice', instructions: 'De qual programa é o vídeo em `arquivo` (caminho de um arquivo baixado, com a pasta)?', criteria: SHOW_CRITERIA },
    },
  };
}

/** The role of each file (at most BATCH) of one folder: answers `papel_<i>`. */
export function rolesRequest(folder: string, names: readonly string[]): JevRequest {
  const questions: Record<string, Question> = {};
  names.forEach((_, i) => {
    questions[`papel_${i}`] = {
      type: 'choice',
      instructions: `O que é o vídeo \`arquivos[${i}]\` da pasta \`pasta\`, para um canal que recria um programa infantil de TV?`,
      criteria: ROLE_CRITERIA as Record<string, never>,
    };
  });
  return { state: { pasta: folder, arquivos: names }, questions };
}

/** The station of each clip (at most BATCH paths): answers `marca_<i>`. */
export function brandsRequest(files: readonly string[]): JevRequest {
  const questions: Record<string, Question> = {};
  files.forEach((_, i) => {
    questions[`marca_${i}`] = { type: 'choice', instructions: `De qual emissora é a vinheta \`arquivos[${i}]\`?`, criteria: BRANDS };
  });
  return { state: { arquivos: files }, questions };
}

export const chunks = <T>(items: readonly T[], size = BATCH): T[][] =>
  Array.from({ length: Math.ceil(items.length / size) }, (_, i) => items.slice(i * size, i * size + size));
