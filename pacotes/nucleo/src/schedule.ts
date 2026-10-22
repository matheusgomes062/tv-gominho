import { parse } from 'yaml';
import { normalizeEpisodeRef } from './agenda';
import { WEEKDAYS, isIsoDate, isoToDayNumber, parseTimeOfDay, weekdayOf, type Weekday } from './dates';
import { basename, fold, stripExtension } from './paths';
import { parseAdBreaks } from './settings';
import type { AgendaPick, LibraryWarning, Schedule, ScheduleBlock, ScheduleItem } from './types';

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

  const adBreaks = raw.intervalos === undefined ? {} : parseAdBreaks(raw.intervalos, warn);

  if (!Array.isArray(raw.blocos) || raw.blocos.length === 0) {
    warn('A grade não tem "blocos".');
    return null;
  }
  const parsed: ParsedBlock[] = [];
  raw.blocos.forEach((rawBlock, i) => {
    const block = parseBlock(rawBlock, i + 1, warn);
    if (block) parsed.push(block);
  });
  if (parsed.length === 0) {
    warn('Nenhum bloco válido na grade.');
    return null;
  }
  parsed.sort((a, b) => a.block.start - b.block.start);
  const blocks = parsed.map((entry) => entry.block);

  const agenda = raw.agenda === undefined || raw.agenda === null ? [] : parseAgenda(raw.agenda, parsed, days, warn);

  return {
    id,
    path,
    name,
    description: typeof raw.descricao === 'string' ? raw.descricao : undefined,
    startDate,
    days,
    blocks,
    ...(breakBumpersRef !== undefined ? { breakBumpersRef } : {}),
    ...(Object.keys(adBreaks).length > 0 ? { adBreaks } : {}),
    ...(agenda.length > 0 ? { agenda } : {}),
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

/** A block and, for each of its items that survived parsing, the 1-based position it had in the file. */
interface ParsedBlock {
  block: ScheduleBlock;
  filePositions: number[];
}

function parseBlock(raw: unknown, position: number, warn: (message: string) => void): ParsedBlock | null {
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
  const filePositions: number[] = [];
  raw.itens.forEach((rawItem, i) => {
    const item = parseItem(rawItem, `${label}, item ${i + 1}`, warn);
    if (item) {
      items.push(item);
      filePositions.push(i + 1);
    }
  });
  return items.length > 0 ? { block: { start, items }, filePositions } : null;
}

/**
 * `agenda`: { "2003-03-05": [{ bloco: "08:00", item: 2, episodio: 12 }] }. Entries are checked here against the
 * schedule itself (date, block, item); whether the episode exists is checked when the library is scanned.
 * `item` counts the items of the block as written in the file, so a bad item above it does not shift it.
 */
function parseAgenda(raw: unknown, blocks: ParsedBlock[], days: Weekday[], warn: (message: string) => void): AgendaPick[] {
  if (!isRecord(raw)) {
    warn('"agenda" deve ser uma lista de datas, cada uma com suas escolhas. Ela foi ignorada.');
    return [];
  }
  const picks: AgendaPick[] = [];
  for (const [key, entries] of Object.entries(raw)) {
    const date = String(key);
    const label = `Agenda de ${date}`;
    if (!isIsoDate(date)) {
      warn(`${label}: data inválida. Use o formato AAAA-MM-DD, por exemplo 2003-03-05. Ela foi ignorada.`);
      continue;
    }
    const weekday = weekdayOf(isoToDayNumber(date));
    if (!days.includes(weekday)) {
      warn(`${label}: cai num dia (${weekday}) que não está em "dias" da grade. Ela foi ignorada.`);
      continue;
    }
    if (!Array.isArray(entries)) {
      warn(`${label}: deve ser uma lista de escolhas, cada uma com "bloco", "item" e "episodio". Ela foi ignorada.`);
      continue;
    }
    entries.forEach((entry, i) => {
      const pick = parsePick(entry, date, `${label}, escolha ${i + 1}`, blocks, warn);
      if (!pick) return;
      if (picks.some((other) => other.date === pick.date && other.blockStart === pick.blockStart && other.item === pick.item)) {
        warn(`${label}, escolha ${i + 1}: esse item já tem um episódio escolhido nessa data. Vale o primeiro.`);
        return;
      }
      picks.push(pick);
    });
  }
  return picks.sort((a, b) => a.date.localeCompare(b.date) || a.blockStart - b.blockStart || a.item - b.item);
}

function parsePick(raw: unknown, date: string, label: string, blocks: ParsedBlock[], warn: (message: string) => void): AgendaPick | null {
  if (!isRecord(raw)) {
    warn(`${label}: formato inválido. Use "bloco", "item" e "episodio". Ela foi ignorada.`);
    return null;
  }
  const blockStart = parseTimeOfDay(String(raw.bloco ?? ''));
  const block = blockStart === null ? undefined : blocks.find((entry) => entry.block.start === blockStart);
  if (!block) {
    warn(`${label}: não há bloco "${String(raw.bloco)}" na grade. Use o "horario" de um bloco, entre aspas. Ela foi ignorada.`);
    return null;
  }
  const item = Number(raw.item);
  if (!Number.isInteger(item) || item < 1) {
    warn(`${label}: "item" deve ser a posição do item no bloco, contando de 1. Ela foi ignorada.`);
    return null;
  }
  const parsedAt = block.filePositions.indexOf(item);
  const target = parsedAt >= 0 ? block.block.items[parsedAt] : undefined;
  if (target?.type !== 'show') {
    warn(`${label}: o item ${item} do bloco ${String(raw.bloco)} ${target ? 'não é um "programa"' : 'não existe'}. Ela foi ignorada.`);
    return null;
  }
  const episode = normalizeEpisodeRef(raw.episodio);
  if (episode === null) {
    warn(`${label}: "episodio" deve ser o número do episódio (12) ou "temporada-02/12". Ela foi ignorada.`);
    return null;
  }
  return { date, blockStart: block.block.start, item: parsedAt + 1, episode };
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
