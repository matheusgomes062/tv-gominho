import { parse } from 'yaml';
import { WEEKDAYS, isIsoDate, parseTimeOfDay, type Weekday } from './dates';
import { basename, fold, stripExtension } from './paths';
import type { LibraryWarning, Schedule, ScheduleBlock, ScheduleItem } from './types';

const DEFAULT_START_DATE = '2000-01-01';

/** Parses a schedule file (grades/*.yaml). Returns null if it is unusable. */
export function parseSchedule(path: string, text: string, warnings: LibraryWarning[]): Schedule | null {
  const warn = (message: string) => warnings.push({ path, message });

  let raw: unknown;
  try {
    raw = parse(text);
  } catch (error) {
    warn(`Erro de sintaxe no arquivo da grade: ${(error as Error).message}`);
    return null;
  }
  if (!isRecord(raw)) {
    warn('A grade está vazia ou não é uma lista de configurações (nome, blocos...).');
    return null;
  }

  const id = stripExtension(basename(path));
  const name = typeof raw.nome === 'string' && raw.nome.trim() ? raw.nome.trim() : id;

  let startDate = DEFAULT_START_DATE;
  if (raw.data_inicio !== undefined) {
    const value = String(raw.data_inicio);
    if (isIsoDate(value)) startDate = value;
    else warn(`"data_inicio" inválida (${value}). Use o formato AAAA-MM-DD, por exemplo 2003-03-03.`);
  }

  const days = parseDays(raw.dias, warn);

  let breakBumpersRef: string | undefined;
  if (raw.vinhetas_intervalo !== undefined && raw.vinhetas_intervalo !== null) {
    const ref = typeof raw.vinhetas_intervalo === 'string' ? raw.vinhetas_intervalo.trim().replace(/^\/+|\/+$/g, '') : '';
    if (ref) breakBumpersRef = ref;
    else warn('"vinhetas_intervalo" deve ser uma pasta ou arquivo de vinhetas, por exemplo "intervalos/tv-globinho". Ela foi ignorada.');
  }

  if (!Array.isArray(raw.blocos) || raw.blocos.length === 0) {
    warn('A grade não tem "blocos".');
    return null;
  }
  const blocks: ScheduleBlock[] = [];
  raw.blocos.forEach((rawBlock, i) => {
    const block = parseBlock(rawBlock, i + 1, warn);
    if (block) blocks.push(block);
  });
  if (blocks.length === 0) {
    warn('Nenhum bloco válido na grade.');
    return null;
  }
  blocks.sort((a, b) => a.start - b.start);

  return {
    id,
    path,
    name,
    description: typeof raw.descricao === 'string' ? raw.descricao : undefined,
    startDate,
    days,
    blocks,
    ...(breakBumpersRef !== undefined ? { breakBumpersRef } : {}),
  };
}

function parseDays(value: unknown, warn: (message: string) => void): Weekday[] {
  if (value === undefined) return [...WEEKDAYS];
  if (!Array.isArray(value)) {
    warn('"dias" deve ser uma lista, por exemplo [seg, ter, qua, qui, sex]. Usando todos os dias.');
    return [...WEEKDAYS];
  }
  const days = new Set<Weekday>();
  for (const entry of value) {
    const key = fold(String(entry)).slice(0, 3) as Weekday;
    if (WEEKDAYS.includes(key)) days.add(key);
    else warn(`Dia desconhecido em "dias": ${String(entry)}. Use dom, seg, ter, qua, qui, sex ou sab.`);
  }
  if (days.size === 0) {
    warn('Nenhum dia válido em "dias". Usando todos os dias.');
    return [...WEEKDAYS];
  }
  return WEEKDAYS.filter((day) => days.has(day));
}

function parseBlock(raw: unknown, position: number, warn: (message: string) => void): ScheduleBlock | null {
  const label = `Bloco ${position}`;
  if (!isRecord(raw)) {
    warn(`${label}: formato inválido.`);
    return null;
  }
  const start = parseTimeOfDay(String(raw.horario ?? ''));
  if (start === null) {
    warn(`${label}: "horario" inválido (${String(raw.horario)}). Use "HH:MM" entre aspas, por exemplo "08:00".`);
    return null;
  }
  if (!Array.isArray(raw.itens) || raw.itens.length === 0) {
    warn(`${label}: sem "itens".`);
    return null;
  }
  const items: ScheduleItem[] = [];
  raw.itens.forEach((rawItem, i) => {
    const item = parseItem(rawItem, `${label}, item ${i + 1}`, warn);
    if (item) items.push(item);
  });
  return items.length > 0 ? { start, items } : null;
}

function parseItem(raw: unknown, label: string, warn: (message: string) => void): ScheduleItem | null {
  if (!isRecord(raw)) {
    warn(`${label}: formato inválido.`);
    return null;
  }
  if (raw.programa !== undefined) {
    const count = raw.episodios === undefined ? 1 : Number(raw.episodios);
    if (!Number.isInteger(count) || count < 1) {
      warn(`${label}: "episodios" deve ser um número inteiro maior que zero.`);
      return null;
    }
    return { type: 'show', show: String(raw.programa).trim(), count };
  }
  if (raw.vinheta !== undefined) {
    return { type: 'interstitial', ref: String(raw.vinheta).trim().replace(/^\/+|\/+$/g, '') };
  }
  if (raw.comerciais !== undefined) {
    const count = Number(raw.comerciais);
    if (!Number.isInteger(count) || count < 1) {
      warn(`${label}: "comerciais" deve ser um número inteiro maior que zero.`);
      return null;
    }
    return { type: 'commercials', count };
  }
  warn(`${label}: item desconhecido. Use "programa", "vinheta" ou "comerciais".`);
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
