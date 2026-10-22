import { AD_BREAK_LIMITS, type AdBreakSettings } from './settings';
import { formatTimeOfDay, parseTimeOfDay, WEEKDAYS, type Weekday } from './dates';
import { bumperBrands, bumperEras, yearRange } from './generate';
import { fold } from './paths';
import type { Library } from './types';

// A channel proposed by the optional AI assistant (docs/ferramentas.md#assistente-de-ia): the answers of the
// "Montar a semana" wizard, never a grade file. The server asks the model for this shape (proposalSchema) and checks
// what comes back (validateProposal) before the app shows it in the preview; the app checks it again with its own library.

/** Longest request the person may type. */
export const MAX_REQUEST_LENGTH = 500;
/** Largest model answer read, in characters. A proposal is a few hundred. */
export const MAX_PROPOSAL_TEXT = 16 * 1024;
export const MAX_PROPOSAL_RANGES = 3;
export const MAX_PROPOSAL_NAME = 40;
export const MAX_PROPOSAL_NOTE = 300;
const TIME_STEP = 15 * 60;
const MIN_RANGE = 15 * 60;
const LAST_TIME = 23 * 3600 + 45 * 60;

export interface Proposal {
  name: string;
  /** Seconds since midnight, in order, at least 15 minutes each, not overlapping. */
  ranges: Array<{ start: number; end: number }>;
  days: Weekday[];
  /** Show ids in the order they take turns; empty = every show. */
  shows: string[];
  /** The channel's own break rules, or null to follow the general ones. */
  adBreaks: AdBreakSettings | null;
  /** A bumper brand of the library, or "" for any. */
  brand: string;
  era: number | null;
  /** What the assistant did, in a sentence or two, for the person. */
  note: string;
}

/** The model's answer, as the JSON schema below names it (Portuguese keys, like the grade files). */
interface RawProposal {
  nome: unknown;
  faixas: unknown;
  dias: unknown;
  programas: unknown;
  comerciais: unknown;
  marca: unknown;
  epoca: unknown;
  explicacao: unknown;
}

const playable = (library: Library) => library.shows.filter((show) => show.episodes.length > 0);

/**
 * The JSON schema of a proposal for this library (structured output): show ids and brands are enums, so a model that
 * follows it cannot name one that does not exist. validateProposal checks everything again anyway.
 */
export function proposalSchema(library: Library): Record<string, unknown> {
  const ids = playable(library).map((show) => show.id);
  const brands = ['', ...bumperBrands(library).map((brand) => brand.id)];
  const time = { type: 'string', description: 'HH:MM, de 15 em 15 minutos' };
  return {
    type: 'object',
    additionalProperties: false,
    required: ['nome', 'faixas', 'dias', 'programas', 'comerciais', 'marca', 'epoca', 'explicacao'],
    properties: {
      nome: { type: 'string', description: `Nome curto do canal, até ${MAX_PROPOSAL_NAME} letras` },
      faixas: {
        type: 'array',
        description: `De 1 a ${MAX_PROPOSAL_RANGES} faixas de horário, sem sobreposição`,
        items: { type: 'object', additionalProperties: false, required: ['inicio', 'fim'], properties: { inicio: time, fim: time } },
      },
      dias: { type: 'array', items: { type: 'string', enum: [...WEEKDAYS] } },
      programas: {
        type: 'array',
        description: 'Ids dos programas na ordem em que se revezam; lista vazia = todos os programas',
        items: ids.length > 0 ? { type: 'string', enum: ids } : { type: 'string' },
      },
      comerciais: {
        type: 'object',
        additionalProperties: false,
        required: ['proprios', 'a_cada_minutos', 'por_intervalo', 'depois_do_episodio', 'vinhetas_no_intervalo'],
        properties: {
          proprios: { type: 'boolean', description: 'false = segue a configuração geral e ignora os outros campos' },
          a_cada_minutos: { type: 'integer', description: `${AD_BREAK_LIMITS.every.min} a ${AD_BREAK_LIMITS.every.max}; 0 = sem intervalo no meio do episódio` },
          por_intervalo: { type: 'integer', description: `${AD_BREAK_LIMITS.ads.min} a ${AD_BREAK_LIMITS.ads.max}` },
          depois_do_episodio: { type: 'boolean' },
          vinhetas_no_intervalo: { type: 'boolean' },
        },
      },
      marca: { type: 'string', enum: brands, description: 'Marca das vinhetas; "" = qualquer' },
      epoca: { anyOf: [{ type: 'integer' }, { type: 'null' }], description: 'Ano das vinhetas, ou null' },
      explicacao: { type: 'string', description: 'Uma ou duas frases para os pais sobre o que foi montado' },
    },
  };
}

export type ProposalResult = { ok: true; proposal: Proposal } | { ok: false; error: string };

const bad = (error: string): ProposalResult => ({ ok: false, error });
/** Untrusted text in a message: one line, short. */
const quote = (value: unknown) => `“${String(value).replace(/\s+/g, ' ').slice(0, 40)}”`;
const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Checks a proposal against the library: every show and the bumper brand and era exist, the time ranges are a valid
 * day, the numbers are within the limits of the settings. Times snap to 15 minutes and break numbers are clamped;
 * anything else wrong is a clear error in Portuguese, never a partly applied proposal.
 */
export function validateProposal(value: unknown, library: Library): ProposalResult {
  if (!isObject(value)) return bad('A IA não respondeu com uma proposta.');
  const raw = value as Partial<RawProposal>;

  const name = typeof raw.nome === 'string' ? raw.nome.replace(/\s+/g, ' ').trim() : '';
  if (name === '') return bad('A proposta da IA veio sem nome de canal.');
  if (name.length > MAX_PROPOSAL_NAME) return bad(`O nome proposto passa de ${MAX_PROPOSAL_NAME} letras.`);

  if (!Array.isArray(raw.faixas) || raw.faixas.length === 0) return bad('A proposta da IA veio sem faixas de horário.');
  if (raw.faixas.length > MAX_PROPOSAL_RANGES) return bad(`A IA propôs mais de ${MAX_PROPOSAL_RANGES} faixas de horário.`);
  const ranges: Array<{ start: number; end: number }> = [];
  for (const entry of raw.faixas) {
    const start = isObject(entry) && typeof entry.inicio === 'string' ? parseTimeOfDay(entry.inicio) : null;
    const end = isObject(entry) && typeof entry.fim === 'string' ? parseTimeOfDay(entry.fim) : null;
    if (start === null || end === null) return bad('A IA propôs um horário que não existe.');
    const snap = (seconds: number) => Math.min(LAST_TIME, Math.round(seconds / TIME_STEP) * TIME_STEP);
    ranges.push({ start: snap(start), end: snap(end) });
  }
  ranges.sort((a, b) => a.start - b.start);
  for (const [i, range] of ranges.entries()) {
    const label = `${formatTimeOfDay(range.start)}–${formatTimeOfDay(range.end)}`;
    if (range.end - range.start < MIN_RANGE) return bad(`A faixa ${label} proposta é curta demais ou termina antes de começar.`);
    if (i > 0 && range.start < ranges[i - 1]!.end) return bad('A IA propôs faixas de horário que se sobrepõem.');
  }

  if (!Array.isArray(raw.dias) || raw.dias.length === 0) return bad('A proposta da IA veio sem dias da semana.');
  const unknownDay = raw.dias.find((day) => !(WEEKDAYS as readonly unknown[]).includes(day));
  if (unknownDay !== undefined) return bad(`A IA propôs um dia que não existe: ${quote(unknownDay)}.`);
  const days = WEEKDAYS.filter((day) => (raw.dias as unknown[]).includes(day));

  if (!Array.isArray(raw.programas)) return bad('A proposta da IA veio sem a lista de programas.');
  const shows = playable(library);
  if (raw.programas.length > shows.length) return bad('A IA propôs mais programas do que a biblioteca tem.');
  const picked: string[] = [];
  for (const id of raw.programas) {
    const show = typeof id === 'string' ? shows.find((entry) => entry.id === id) : undefined;
    if (!show) return bad(`A IA propôs um programa que não está na biblioteca: ${quote(id)}.`);
    if (!picked.includes(show.id)) picked.push(show.id);
  }

  const ads = raw.comerciais;
  if (!isObject(ads) || typeof ads.proprios !== 'boolean') return bad('A proposta da IA veio sem as regras de comerciais.');
  const number = (key: string, limits: { min: number; max: number }) => {
    const n = ads[key];
    return typeof n === 'number' && Number.isFinite(n) ? Math.min(limits.max, Math.max(limits.min, Math.round(n))) : null;
  };
  let adBreaks: AdBreakSettings | null = null;
  if (ads.proprios) {
    const every = number('a_cada_minutos', AD_BREAK_LIMITS.every);
    const count = number('por_intervalo', AD_BREAK_LIMITS.ads);
    if (every === null || count === null || typeof ads.depois_do_episodio !== 'boolean' || typeof ads.vinhetas_no_intervalo !== 'boolean') {
      return bad('As regras de comerciais da proposta estão incompletas.');
    }
    adBreaks = { every, ads: count, afterEpisode: ads.depois_do_episodio, bumpers: ads.vinhetas_no_intervalo };
  }

  let brand = '';
  if (raw.marca !== undefined && raw.marca !== null && raw.marca !== '') {
    const found = typeof raw.marca === 'string' ? bumperBrands(library).find((entry) => fold(entry.id) === fold(raw.marca as string)) : undefined;
    if (!found) return bad(`A IA propôs vinhetas de uma marca que não está na biblioteca: ${quote(raw.marca)}.`);
    brand = found.id;
  }
  let era: number | null = null;
  if (raw.epoca !== undefined && raw.epoca !== null) {
    if (typeof raw.epoca !== 'number' || !eraInLibrary(library, brand, raw.epoca)) {
      return bad(`A IA propôs vinhetas de uma época que não está na biblioteca: ${quote(raw.epoca)}.`);
    }
    era = raw.epoca;
  }

  const note = typeof raw.explicacao === 'string' ? raw.explicacao.replace(/\s+/g, ' ').trim().slice(0, MAX_PROPOSAL_NOTE) : '';
  return { ok: true, proposal: { name, ranges, days, shows: picked, adBreaks, brand, era, note } };
}

/** A year some bumper of the brand covers: one of bumperEras, or inside the years of a folder like "tv-globinho-2003-2009". */
const ERA_CATEGORIES = ['aberturas', 'encerramentos', 'chamadas', 'intervalos'];
function eraInLibrary(library: Library, brand: string, era: number): boolean {
  if (!Number.isInteger(era)) return false;
  if (bumperEras(library, brand).includes(era)) return true;
  return library.interstitials.some((item) => {
    if (!ERA_CATEGORIES.includes(item.category)) return false;
    if (brand && !fold(item.relativePath).includes(fold(brand))) return false;
    const range = yearRange(item.relativePath.slice(item.category.length));
    return range !== null && range[0] <= era && era <= range[1];
  });
}

/** A model answer as text: parsed and validated, or why not. */
export function parseProposal(text: string, library: Library): ProposalResult {
  if (text.length > MAX_PROPOSAL_TEXT) return bad('A resposta da IA veio grande demais.');
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return bad('A IA respondeu num formato que o app não entende. Tente de novo.');
  }
  return validateProposal(value, library);
}

/** A proposal back in the shape of the schema: what the app sends as "the wizard as it is now". */
export function proposalToRaw(proposal: Proposal): RawProposal {
  return {
    nome: proposal.name,
    faixas: proposal.ranges.map((range) => ({ inicio: formatTimeOfDay(range.start), fim: formatTimeOfDay(range.end) })),
    dias: proposal.days,
    programas: proposal.shows,
    comerciais: proposal.adBreaks
      ? {
          proprios: true,
          a_cada_minutos: proposal.adBreaks.every,
          por_intervalo: proposal.adBreaks.ads,
          depois_do_episodio: proposal.adBreaks.afterEpisode,
          vinhetas_no_intervalo: proposal.adBreaks.bumpers,
        }
      : { proprios: false, a_cada_minutos: 0, por_intervalo: 1, depois_do_episodio: false, vinhetas_no_intervalo: false },
    marca: proposal.brand,
    epoca: proposal.era,
    explicacao: proposal.note,
  };
}
