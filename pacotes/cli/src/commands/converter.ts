import { existsSync } from 'node:fs';
import { mkdir, rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { CONVERTIBLE_VIDEO, PLAYABLE_VIDEO, extension, naturalCompare, scanLibrary } from '@tv-gominho/nucleo';
import {
  DEFAULT_LOUDNESS,
  buildConvertArgs,
  freeName,
  loudnormMeasureArgs,
  originalsPath,
  parseLoudnormStats,
  planConversion,
  samePath,
  targetPath,
  tempPath,
  validateOutput,
  type EncodeOptions,
  type Plan,
} from '../convert/plan';
import { CliError, UsageError } from '../errors';
import { lastError, locateFfmpeg, probe, run, type FfmpegTools, type MediaInfo } from '../ffmpeg';
import { openNodeLibrary, type NodeLibrarySource } from '../node-source';
import { ffmpegOptions, helpOptions, intOption, parseOptions } from '../options';
import { ProgressLine, formatBytes, formatDuration, plural } from '../ui';
import type { Command, CommandContext } from './types';

const OPTIONS = {
  ...helpOptions,
  ...ffmpegOptions,
  simular: { type: 'boolean' },
  qualidade: { type: 'string' },
  preset: { type: 'string' },
  'normalizar-audio': { type: 'boolean' },
  'duas-passadas': { type: 'boolean' },
  'faixa-audio': { type: 'string' },
  'manter-originais': { type: 'boolean' },
  'apagar-originais': { type: 'boolean' },
} as const;

const PRESETS = ['ultrafast', 'superfast', 'veryfast', 'faster', 'fast', 'medium', 'slow', 'slower', 'veryslow'];
const DEFAULT_CRF = 20;
const DEFAULT_PRESET = 'medium';
/** Sections of the library that hold videos the app plays. */
const VIDEO_SECTIONS = ['programas', 'vinhetas'];
const SECTIONS = ['programas', 'vinhetas', 'grades'];
const PROBE_CONCURRENCY = 4;

const HELP = `Uso:
  tv-gominho converter <biblioteca> [opções]

Converte para MP4 (H.264 + AAC) os vídeos da biblioteca que o app não toca:
  - formatos antigos (AVI, MKV, WMV, MPG, RMVB, FLV, VOB, TS...);
  - arquivos .mp4/.mov/.m4v com codecs que o navegador e as TVs não tocam
    (HEVC, MPEG-4 Parte 2, vídeo de 10 bits, áudio AC3/DTS...).
Quando o vídeo já é H.264 e o áudio já é AAC estéreo, só troca o contêiner
(rápido, sem perda de qualidade). O arquivo novo fica ao lado do original,
com o mesmo nome e a extensão .mp4.

<biblioteca> é a pasta "biblioteca" (ou a pasta que a contém, como um pendrive).
Só arquivos dentro de programas/ e vinhetas/ dessa biblioteca são tocados.

O que acontece com os originais (nada é apagado a menos que você peça):
  (padrão)             o original é movido para <biblioteca>/.originais/, com as
                       mesmas subpastas. Depois de conferir, você pode apagar essa pasta.
  --manter-originais   o original fica onde está. Atenção: o app continua avisando
                       sobre o formato antigo até você tirar o arquivo da biblioteca.
                       (Um .mp4 que precisa ser recodificado tem o mesmo nome do
                       arquivo novo, então esse caso sempre vai para .originais.)
  --apagar-originais   o original é apagado depois que o MP4 novo foi conferido.

Opções:
  --simular            só mostra o que seria feito e por quê; não altera nada
  --qualidade <n>      qualidade do vídeo recodificado (CRF x264, 0-51; menor = melhor
                       e maior). Padrão: ${DEFAULT_CRF}
  --preset <nome>      velocidade do x264: ${PRESETS.join(', ')}.
                       Padrão: ${DEFAULT_PRESET}. Mais lento = arquivo menor
  --normalizar-audio   iguala o volume (EBU R128, -16 LUFS) nos arquivos convertidos
  --duas-passadas      com --normalizar-audio: mede o volume antes (mais preciso e mais lento)
  --faixa-audio <n>    qual faixa de áudio manter, começando em 1. Padrão: 1
  --ffmpeg <caminho>   ffmpeg a usar (arquivo ou pasta). Também vale a variável FFMPEG
  --ajuda              mostra esta ajuda

Exemplos:
  tv-gominho converter E:\\biblioteca --simular
  tv-gominho converter ./biblioteca --normalizar-audio
  tv-gominho converter ./biblioteca --preset slow --qualidade 18

Ctrl+C interrompe com segurança: o arquivo parcial é apagado e nada é movido.
Rodar de novo continua de onde parou: o que já foi convertido é pulado.`;

type Disposition = 'mover' | 'manter' | 'apagar';

interface Settings {
  folder: string;
  simulate: boolean;
  encode: EncodeOptions;
  twoPass: boolean;
  disposition: Disposition;
  ffmpeg?: string;
}

type Status = 'convert' | 'already' | 'skip' | 'error';

interface Item {
  path: string;
  target: string;
  status: Status;
  info?: MediaInfo;
  plan?: Plan;
  /** Reasons to show (pt-BR) or the error message. */
  notes: string[];
}

export const converterCommand: Command = {
  name: 'converter',
  summary: 'Converte vídeos antigos ou incompatíveis da biblioteca para MP4 (H.264 + AAC)',
  help: HELP,
  async run(argv, context) {
    const { values, positionals } = parseOptions(argv, OPTIONS);
    if (values.ajuda) {
      console.log(HELP);
      return 0;
    }
    if (positionals.length !== 1) {
      throw new UsageError('Informe a pasta da biblioteca: tv-gominho converter <biblioteca>. Veja "tv-gominho converter --ajuda".');
    }
    return convert(readSettings(values, positionals[0]!), context);
  },
};

function readSettings(values: Record<string, string | boolean | undefined>, folder: string): Settings {
  if (values['manter-originais'] && values['apagar-originais']) {
    throw new UsageError('Use --manter-originais ou --apagar-originais, não os dois.');
  }
  if (values['duas-passadas'] && !values['normalizar-audio']) {
    throw new UsageError('--duas-passadas só faz sentido junto com --normalizar-audio.');
  }
  const preset = (values.preset as string | undefined) ?? DEFAULT_PRESET;
  if (!PRESETS.includes(preset)) throw new UsageError(`--preset "${preset}" não existe. Use: ${PRESETS.join(', ')}.`);

  const track = intOption('--faixa-audio', values['faixa-audio'] as string | undefined, 1, 32) ?? 1;
  return {
    folder,
    simulate: Boolean(values.simular),
    encode: {
      crf: intOption('--qualidade', values.qualidade as string | undefined, 0, 51) ?? DEFAULT_CRF,
      preset,
      audioTrack: track - 1,
      loudness: values['normalizar-audio'] ? DEFAULT_LOUDNESS : undefined,
    },
    twoPass: Boolean(values['duas-passadas']),
    disposition: values['apagar-originais'] ? 'apagar' : values['manter-originais'] ? 'manter' : 'mover',
    ffmpeg: values.ffmpeg as string | undefined,
  };
}

async function convert(settings: Settings, { signal }: CommandContext): Promise<number> {
  const source = await openNodeLibrary(settings.folder);
  const library = await scanLibrary(source);
  const root = library.root;

  if (!source.files.some((file) => SECTIONS.includes(file.slice(root.length).split('/')[0]!.toLowerCase()))) {
    throw new CliError(
      `"${source.dir}" não parece ser uma biblioteca: não achei as pastas programas/, vinhetas/ ou grades/.\n` +
        'Informe a pasta "biblioteca" (veja docs/biblioteca.md). Por segurança, nada é convertido fora de uma biblioteca.',
    );
  }

  const videos = source.files
    .filter((file) => file.toLowerCase().startsWith(root.toLowerCase()))
    .filter((file) => VIDEO_SECTIONS.includes(file.slice(root.length).split('/')[0]!.toLowerCase()))
    .filter((file) => PLAYABLE_VIDEO.has(extension(file)) || CONVERTIBLE_VIDEO.has(extension(file)))
    .sort(naturalCompare);

  console.log(`Biblioteca: ${source.dir}${root ? ` (pasta ${root.replace(/\/$/, '')})` : ''}`);
  if (videos.length === 0) {
    console.log('Nenhum vídeo encontrado em programas/ ou vinhetas/.');
    return 0;
  }

  const tools = await locateFfmpeg({ ffmpeg: settings.ffmpeg });
  const items = await analyze(source, tools, videos, settings, signal);
  if (signal.aborted) return interrupted();

  report(items, settings);
  if (settings.simulate || !items.some((item) => isPending(item, settings))) {
    if (settings.simulate) console.log('\nModo --simular: nada foi alterado.');
    else if (!items.some((item) => item.status === 'error')) console.log('\nNada a fazer.');
    return items.some((item) => item.status === 'error') ? 1 : 0;
  }

  return execute(source, tools, root, items, settings, signal);
}

// ---------------------------------------------------------------- analysis

async function analyze(
  source: NodeLibrarySource,
  tools: FfmpegTools,
  videos: string[],
  settings: Settings,
  signal: AbortSignal,
): Promise<Item[]> {
  const items = new Array<Item>(videos.length);
  let next = 0;
  let done = 0;
  const interactive = Boolean(process.stdout.isTTY);

  async function worker() {
    while (!signal.aborted) {
      const index = next++;
      if (index >= videos.length) return;
      items[index] = await analyzeOne(source, tools, videos[index]!, settings);
      done++;
      if (interactive) process.stdout.write(`\rAnalisando ${done}/${videos.length} vídeos...`);
    }
  }
  if (!interactive) console.log(`Analisando ${plural(videos.length, 'vídeo')}...`);
  await Promise.all(Array.from({ length: Math.min(PROBE_CONCURRENCY, videos.length) }, worker));
  if (interactive) process.stdout.write('\r\x1b[K');

  // Two sources can't share one target ("a.avi" and "a.mkv" both become "a.mp4").
  const claimed = new Map<string, string>();
  for (const item of items) {
    if (!item || item.status === 'skip' || item.status === 'error') continue;
    const key = item.target.toLowerCase();
    const owner = claimed.get(key);
    if (owner && !samePath(owner, item.path)) {
      item.status = 'error';
      item.notes = [`o destino ${item.target} é o mesmo de ${owner}; renomeie um dos dois`];
    } else {
      claimed.set(key, item.path);
    }
  }
  return items.filter(Boolean);
}

async function analyzeOne(source: NodeLibrarySource, tools: FfmpegTools, file: string, settings: Settings): Promise<Item> {
  const target = targetPath(file);
  try {
    const info = await probe(tools, source.resolve(file));
    const plan = planConversion(file, info, { normalize: Boolean(settings.encode.loudness), audioTrack: settings.encode.audioTrack });
    if (plan.error) return { path: file, target, status: 'error', info, plan, notes: [plan.error] };
    if (plan.action === 'skip') return { path: file, target, status: 'skip', info, plan, notes: plan.reasons };

    // A finished conversion from an earlier run: reuse it instead of encoding again.
    if (!samePath(file, target) && existsSync(source.resolve(target))) {
      const existing = await probe(tools, source.resolve(target)).catch(() => null);
      const problem = existing ? validateOutput(info, existing) : 'não é um vídeo legível';
      if (!problem) return { path: file, target, status: 'already', info, plan, notes: [`${target} já existe e está válido`] };
      return {
        path: file,
        target,
        status: 'error',
        info,
        plan,
        notes: [`já existe ${target}, mas ${problem}; ele não será sobrescrito. Mova ou apague esse arquivo e rode de novo`],
      };
    }
    return { path: file, target, status: 'convert', info, plan, notes: plan.reasons };
  } catch (error) {
    return { path: file, target, status: 'error', notes: [`não consegui ler o arquivo: ${(error as Error).message}`] };
  }
}

/** An earlier conversion only needs work when its original has to be moved or deleted. */
function isPending(item: Item, settings: Settings): boolean {
  return item.status === 'convert' || (item.status === 'already' && settings.disposition !== 'manter');
}

// ---------------------------------------------------------------- report

function describe(item: Item): string {
  switch (item.status) {
    case 'convert':
      return item.plan?.action === 'remux' ? 'trocar contêiner' : 'converter';
    case 'already':
      return 'já convertido';
    case 'error':
      return 'erro';
    default:
      return 'compatível';
  }
}

function report(items: Item[], settings: Settings) {
  const actionable = items.filter((item) => item.status !== 'skip');
  const skipped = items.length - actionable.length;
  console.log(`${plural(items.length, 'vídeo')} analisado${items.length === 1 ? '' : 's'}; ${skipped} já ${skipped === 1 ? 'toca' : 'tocam'} sem conversão.`);
  if (actionable.length === 0) return;

  console.log('');
  if (settings.simulate) console.log('O que seria feito:');
  for (const item of actionable) {
    console.log(`  [${describe(item)}] ${item.path}`);
    if (item.notes.length > 0) console.log(`      ${item.notes.join('; ')}`);
  }
  if (settings.simulate) {
    const todo = actionable.filter((item) => item.status === 'convert');
    const remux = todo.filter((item) => item.plan?.action === 'remux').length;
    const seconds = todo.reduce((sum, item) => sum + (item.info?.duration ?? 0), 0);
    console.log(
      `\n${plural(todo.length, 'arquivo')} para converter (${remux} só ${remux === 1 ? 'troca' : 'trocam'} o contêiner), ${formatDuration(seconds)} de vídeo no total.`,
    );
    console.log(originalsNote(settings.disposition));
  }
}

function originalsNote(disposition: Disposition): string {
  if (disposition === 'mover') return 'Os originais seriam movidos para .originais/ (nada é apagado).';
  if (disposition === 'manter') return 'Os originais ficariam onde estão.';
  return 'Os originais seriam APAGADOS depois da conversão (--apagar-originais).';
}

// ---------------------------------------------------------------- execution

interface Totals {
  converted: number;
  remuxed: number;
  already: number;
  failed: number;
  bytesBefore: number;
  bytesAfter: number;
  moved: number;
}

async function execute(
  source: NodeLibrarySource,
  tools: FfmpegTools,
  root: string,
  items: Item[],
  settings: Settings,
  signal: AbortSignal,
): Promise<number> {
  const started = Date.now();
  const totals: Totals = { converted: 0, remuxed: 0, already: 0, failed: items.filter((item) => item.status === 'error').length, bytesBefore: 0, bytesAfter: 0, moved: 0 };
  const queue = items.filter((item) => isPending(item, settings));

  console.log(`\n${originalsNote(settings.disposition)}\n`);
  let attempted = 0;
  for (const item of queue) {
    if (signal.aborted) break;
    console.log(`[${attempted + 1}/${queue.length}] ${item.path}`);
    if (item.notes.length > 0) console.log(`  ${item.notes.join('; ')}`);

    try {
      if (item.status === 'convert') {
        const done = await convertOne(source, tools, item, settings, signal);
        if (!done) break; // interrupted: the temp file is already gone
        totals.bytesBefore += (await stat(source.resolve(item.path)).catch(() => null))?.size ?? item.info?.size ?? 0;
        if (item.plan?.action === 'remux') totals.remuxed++;
        else totals.converted++;
      } else {
        totals.already++;
      }
      if (await finalize(source, root, item, settings, signal)) totals.moved++;
      totals.bytesAfter += (await stat(source.resolve(item.target)).catch(() => null))?.size ?? 0;
    } catch (error) {
      totals.failed++;
      console.log(`  ERRO: ${(error as Error).message}`);
    }
    attempted++;
  }

  summary(totals, attempted, queue.length, root, source, settings, Date.now() - started);
  if (signal.aborted) return interrupted();
  return totals.failed > 0 ? 1 : 0;
}

/**
 * Writes the converted file under a temporary name next to the original.
 * Returns false when interrupted. The temp file never survives a failure.
 */
async function convertOne(source: NodeLibrarySource, tools: FfmpegTools, item: Item, settings: Settings, signal: AbortSignal): Promise<boolean> {
  const { info, plan } = item;
  if (!info || !plan) throw new CliError('Item sem análise.');
  const input = source.resolve(item.path);
  const temp = await source.resolveForWrite(tempPath(item.path));
  // A leftover temp file (or a planted link with its name) goes first: ffmpeg would write through a link.
  await rm(temp, { force: true });
  let encode = settings.encode;

  try {
    if (settings.twoPass && plan.audio === 'encode' && encode.loudness) {
      console.log('  Medindo o volume...');
      const bar = new ProgressLine();
      const measure = await run(tools, loudnormMeasureArgs(input, encode), {
        duration: info.duration,
        logLevel: 'info',
        signal,
        onProgress: (progress) => bar.update(progress),
      });
      bar.finish();
      if (measure.aborted) {
        await rm(temp, { force: true });
        return false;
      }
      const stats = parseLoudnormStats(measure.stderr);
      if (!measure.ok) throw new CliError(`falha ao medir o volume: ${lastError(measure.stderr)}`);
      if (stats) encode = { ...encode, loudness: { ...encode.loudness, measured: stats } };
      else console.log('  Não deu para medir o volume (áudio mudo?); usando normalização de uma passada.');
    }

    const bar = new ProgressLine();
    const result = await run(tools, buildConvertArgs(input, temp, plan, encode), {
      duration: info.duration,
      signal,
      onProgress: (progress) => bar.update(progress),
    });
    bar.finish();
    if (result.aborted) {
      await rm(temp, { force: true });
      return false;
    }
    if (!result.ok) throw new CliError(`o ffmpeg falhou: ${lastError(result.stderr)}`);

    const output = await probe(tools, temp).catch((error: Error) => {
      throw new CliError(`o arquivo convertido não pôde ser lido: ${error.message}`);
    });
    const problem = validateOutput(info, output);
    if (problem) throw new CliError(problem);
    return true;
  } catch (error) {
    await rm(temp, { force: true });
    throw error;
  }
}

/**
 * Puts the new file in place and deals with the original according to the chosen
 * disposition. Returns true when the original was moved to .originais.
 */
async function finalize(source: NodeLibrarySource, root: string, item: Item, settings: Settings, signal: AbortSignal): Promise<boolean> {
  if (signal.aborted) {
    await rm(source.resolve(tempPath(item.path)), { force: true });
    return false;
  }
  const original = await source.resolveForWrite(item.path);
  const target = await source.resolveForWrite(item.target);
  const temp = await source.resolveForWrite(tempPath(item.path));
  const sameName = samePath(item.path, item.target);

  /** Moves the original into .originais/ and returns where it went. */
  async function moveToOriginals(): Promise<string> {
    const destination = freeName(originalsPath(root, item.path), (candidate) => existsSync(source.resolve(candidate)));
    const absolute = await source.resolveForWrite(destination);
    await mkdir(path.dirname(absolute), { recursive: true });
    await rename(original, absolute);
    return absolute;
  }

  if (item.status === 'already') {
    // The conversion exists from an earlier run; only the original is left to deal with.
    if (settings.disposition === 'mover') return moveToOriginals().then(() => true);
    if (settings.disposition === 'apagar') await rm(original);
    return false;
  }

  if (sameName) {
    // The new file has the original's name (a recoded .mp4): the original has to leave first.
    if (settings.disposition === 'apagar') {
      await rename(temp, target); // replaces the original
      return false;
    }
    const moved = await moveToOriginals();
    try {
      await rename(temp, target);
    } catch (error) {
      // Put the original back so the library is never left without the episode.
      await rename(moved, original).catch(() => undefined);
      throw error;
    }
    return true;
  }

  await rename(temp, target);
  if (settings.disposition === 'mover') {
    await moveToOriginals();
    return true;
  }
  if (settings.disposition === 'apagar') await rm(original);
  return false;
}

function summary(totals: Totals, attempted: number, total: number, root: string, source: NodeLibrarySource, settings: Settings, elapsedMs: number) {
  console.log('\nResumo');
  console.log(`  Convertidos: ${totals.converted}`);
  if (totals.remuxed > 0) console.log(`  Só troca de contêiner: ${totals.remuxed}`);
  if (totals.already > 0) console.log(`  Já convertidos antes: ${totals.already}`);
  console.log(`  Falhas: ${totals.failed}`);
  if (attempted < total) console.log(`  Não processados (interrompido): ${total - attempted}`);
  if (totals.bytesBefore > 0) {
    console.log(`  Tamanho dos convertidos: ${formatBytes(totals.bytesBefore)} -> ${formatBytes(totals.bytesAfter)}`);
  }
  console.log(`  Tempo: ${formatDuration(elapsedMs / 1000)}`);
  if (totals.moved > 0) {
    console.log(`\nOs originais movidos estão em ${path.join(source.dir, root, '.originais')}`);
    console.log('Confira se está tudo certo e, depois, apague essa pasta para liberar espaço.');
  }
  if (settings.disposition === 'manter' && totals.converted + totals.remuxed > 0) {
    console.log('\nOs originais continuam na biblioteca; tire-os de lá para o app parar de avisar sobre o formato antigo.');
  }
}

function interrupted(): number {
  console.log('\nInterrompido. Arquivos parciais foram apagados e nenhum original foi mexido pela conversão em andamento.');
  console.log('Rode o mesmo comando de novo para continuar de onde parou.');
  return 130;
}
