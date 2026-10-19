import { mkdir, readdir, stat, statfs, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { AUTO_SCHEDULE_ID, createAutoSchedule, findChannelIndex, localIsoDate, scanLibrary, type Library, type Schedule, type Settings } from '@tv-gominho/nucleo';
import { CliError, UsageError } from '../errors';
import { Durations } from '../durations';
import { locateFfmpeg } from '../ffmpeg';
import { openNodeLibrary, type NodeLibrarySource } from '../node-source';
import { ffmpegOptions, helpOptions, intOption, parseOptions } from '../options';
import { formatBytes, formatDuration, plural } from '../ui';
import { formatDate, isIsoDate, weekdayName } from '../pendrive/calendar';
import { copyLibrary } from '../pendrive/copy';
import { checkDestination, destPath } from '../pendrive/dest';
import { LIBRARY_FOLDER, PLAY_FOLDER, README_FILE, TEMP_FOLDER, isPartFileName, partFileName, partNaming } from '../pendrive/names';
import { PART_TARGET_BYTES, splitParts } from '../pendrive/parts';
import { buildReadme, settingsSummary } from '../pendrive/readme';
import { describe, removeTemp, renderRundown } from '../pendrive/render';
import { airingDates, buildRundown, chooseFps, planTimelines, type DurationSource, type Rundown, type RundownDay } from '../pendrive/rundown';
import { DEFAULT_OUTPUT_HEIGHT, OUTPUT_HEIGHTS, type EncodeSettings, type OutputHeight } from '../pendrive/segment';
import {
  DEFAULT_CRF,
  DEFAULT_DAYS,
  DEFAULT_PRESET,
  MAX_DAYS,
  PRESETS,
  applyFlags,
  encodeSettings,
  estimateSize,
  type SettingsFlags,
} from '../pendrive/settings';
import type { Command, CommandContext } from './types';

const OPTIONS = {
  ...helpOptions,
  ...ffmpegOptions,
  destino: { type: 'string', short: 'd' },
  grade: { type: 'string', short: 'g' },
  dias: { type: 'string' },
  'a-partir-de': { type: 'string' },
  'sem-crt': { type: 'boolean' },
  crt: { type: 'string' },
  curvatura: { type: 'string' },
  'sem-vinhetas': { type: 'boolean' },
  'sem-comerciais': { type: 'boolean' },
  'intervalo-a-cada': { type: 'string' },
  proporcao: { type: 'string' },
  'copiar-biblioteca': { type: 'boolean' },
  qualidade: { type: 'string' },
  preset: { type: 'string' },
  resolucao: { type: 'string', short: 'r' },
  paralelo: { type: 'string' },
  simular: { type: 'boolean' },
} as const;

const HELP = `Uso:
  tv-gominho pendrive <biblioteca> --destino <pasta> [opções]

Gera arquivos MP4 comuns com a programação já montada, para tocar em qualquer TV pelo
USB, sem instalar nada. Usa o mesmo motor de grade do app: cada dia começa pelo primeiro
bloco da grade e os episódios avançam de um dia para o outro, com vinhetas e intervalos
comerciais. Cada dia vira um ou mais arquivos de menos de 4 GB (pendrives em FAT32 não
aceitam mais que isso), que terminam, sempre que dá, logo depois de um intervalo.

Resultado em <destino>:
  ASSISTA AQUI/Dia 01 - Parte 1.mp4 ...   os vídeos, na ordem em que a TV toca
  LEIA-ME.txt                             como tocar na TV e o que foi usado
  biblioteca/                             só com --copiar-biblioteca

<biblioteca> é a pasta "biblioteca" (ou a pasta que a contém). As configurações vêm do
configuracoes.yaml dela; as opções abaixo mandam mais.

Qual programação:
  --destino, -d <pasta>       onde gravar (o pendrive, por exemplo E:\\). Obrigatório,
                              menos com --simular. Não pode ficar dentro da biblioteca
  --grade, -g <nome|arquivo>  a grade (nome ou nome do arquivo, sem acento e sem maiúsculas).
                              Padrão: a primeira grade; sem grades, o Canal Automático
  --dias <n>                  quantos dias de exibição da grade gerar. Padrão: ${DEFAULT_DAYS}
  --a-partir-de AAAA-MM-DD    o primeiro dia. Padrão: hoje (ou o próximo dia em que a grade
                              vai ao ar). Os dias fora da grade (fim de semana) são pulados

Configurações (valem no lugar das da biblioteca):
  --sem-crt                   sem o efeito de TV de tubo: só ajusta o tamanho do vídeo
  --crt suave|media|forte     intensidade do efeito
  --curvatura <0-100>         curvatura da tela (0 = reta)
  --sem-vinhetas              sem vinhetas (aberturas, intervalos...)
  --sem-comerciais            sem comerciais e sem intervalos comerciais
  --intervalo-a-cada <n>      minutos de episódio entre intervalos (0 a 30; 0 = só no fim)
  --proporcao 4:3|esticar     4:3 deixa barras pretas nas laterais (padrão); esticar enche a
                              tela. A configuração "original" do yaml também vale

Qualidade e velocidade:
  --resolucao, -r 720|480     linhas da imagem. 720 (padrão): 1280x720. 480: 854x480, arquivos com
                              cerca de metade do tamanho, e tocam em TVs e aparelhos mais antigos
                              (a TV Globinho era em definição padrão, então quase não se nota)
  --qualidade <n>             qualidade do vídeo (CRF do x264, 0-51; menor = melhor e maior).
                              Padrão: ${DEFAULT_CRF}
  --preset <nome>             velocidade do x264: ${PRESETS.join(', ')}.
                              Padrão: ${DEFAULT_PRESET}. Mais lento = arquivos menores
  --paralelo <n>              quantos vídeos renderizar ao mesmo tempo (1 a 8). Padrão: automático,
                              conforme os núcleos do processador

Outras:
  --copiar-biblioteca         copia a biblioteca para <destino>/biblioteca (sem .originais
                              nem arquivos ocultos), para o app de uma TV Box usar o mesmo pendrive
  --simular                   mostra o que seria gerado (dias, itens, intervalos, tamanhos
                              estimados) sem renderizar nada
  --ffmpeg <caminho>          ffmpeg a usar (arquivo ou pasta). Também vale a variável FFMPEG
  --ajuda                     mostra esta ajuda

Vídeo gerado: MP4, H.264 High nível 4.0, 1280x720 (com --resolucao 480: Main nível 3.1,
854x480), 25 ou 30 quadros por segundo (o que a
maioria dos vídeos já tem), som AAC estéreo 48 kHz com o volume igualado.

Exemplos:
  tv-gominho pendrive ./biblioteca --destino E:\\ --simular
  tv-gominho pendrive ./biblioteca --destino E:\\ --grade globinho-2003 --dias 5
  tv-gominho pendrive ./biblioteca -d E:\\ --sem-comerciais --crt suave --copiar-biblioteca

Ctrl+C interrompe com segurança: arquivos pela metade são apagados e o que já foi
renderizado fica guardado em ${TEMP_FOLDER}/. Rodar de novo continua de onde parou.`;

export const pendriveCommand: Command = {
  name: 'pendrive',
  summary: 'Gera o pendrive: a programação pré-renderizada em MP4, para tocar em qualquer TV',
  help: HELP,
  async run(argv, context) {
    const { values, positionals } = parseOptions(argv, OPTIONS);
    if (values.ajuda) {
      console.log(HELP);
      return 0;
    }
    if (positionals.length !== 1) {
      throw new UsageError('Informe a pasta da biblioteca: tv-gominho pendrive <biblioteca> --destino <pasta>. Veja "tv-gominho pendrive --ajuda".');
    }
    if (!values.destino && !values.simular) {
      throw new UsageError('Informe onde gravar com --destino <pasta> (ou use --simular para só ver o que seria gerado).');
    }
    const preset = values.preset ?? DEFAULT_PRESET;
    if (!PRESETS.includes(preset)) throw new UsageError(`--preset "${preset}" não existe. Use: ${PRESETS.join(', ')}.`);
    const resolution = values.resolucao?.toLowerCase().replace(/p$/, '');
    const height = resolution === undefined ? DEFAULT_OUTPUT_HEIGHT : (OUTPUT_HEIGHTS.find((h) => String(h) === resolution) ?? null);
    if (height === null) throw new UsageError(`--resolucao "${values.resolucao}" não existe. Use: ${OUTPUT_HEIGHTS.join(' ou ')}.`);
    const from = values['a-partir-de'];
    if (from !== undefined && !isIsoDate(from)) throw new UsageError(`--a-partir-de precisa ser uma data no formato AAAA-MM-DD (recebi "${from}").`);

    return pendrive(
      {
        folder: positionals[0]!,
        destination: values.destino,
        schedule: values.grade,
        days: intOption('--dias', values.dias, 1, MAX_DAYS) ?? DEFAULT_DAYS,
        from,
        flags: values as SettingsFlags,
        crf: intOption('--qualidade', values.qualidade, 0, 51) ?? DEFAULT_CRF,
        preset,
        height,
        concurrency: intOption('--paralelo', values.paralelo, 1, 8),
        copyLibrary: Boolean(values['copiar-biblioteca']),
        simulate: Boolean(values.simular),
        ffmpeg: values.ffmpeg,
      },
      context,
    );
  },
};

interface Job {
  folder: string;
  destination: string | undefined;
  schedule: string | undefined;
  days: number;
  from: string | undefined;
  flags: SettingsFlags;
  crf: number;
  preset: string;
  height: OutputHeight;
  concurrency: number | undefined;
  copyLibrary: boolean;
  simulate: boolean;
  ffmpeg: string | undefined;
}

const SECTIONS = ['programas', 'vinhetas', 'grades'];

/** Which schedule to export: the one asked for, else the first, else the automatic channel. */
export function chooseSchedule(library: Library, reference: string | undefined): Schedule {
  if (reference !== undefined) {
    const index = findChannelIndex(library.schedules, reference);
    if (index < 0) {
      const names = library.schedules.map((schedule) => `"${schedule.name}"`).join(', ');
      throw new CliError(`Não achei a grade "${reference}" na biblioteca.${names ? ` Grades disponíveis: ${names}.` : ' A biblioteca não tem grades (sem --grade, uso o Canal Automático).'}`);
    }
    return library.schedules[index]!;
  }
  const schedule = library.schedules[0] ?? createAutoSchedule(library);
  if (!schedule) throw new CliError('A biblioteca não tem grades nem programas com episódios: não há o que gerar.');
  return schedule;
}


async function pendrive(job: Job, { signal }: CommandContext): Promise<number> {
  const source = await openNodeLibrary(job.folder);
  const library = await scanLibrary(source);
  if (!source.files.some((file) => SECTIONS.includes(file.slice(library.root.length).split('/')[0]!.toLowerCase()))) {
    throw new CliError(`"${source.dir}" não parece ser uma biblioteca: não achei as pastas programas/, vinhetas/ ou grades/.\nInforme a pasta "biblioteca" (veja docs/biblioteca.md).`);
  }
  const libraryDir = path.join(source.dir, library.root);
  const destination = job.destination ? await checkDestination(job.destination, libraryDir) : undefined;

  const settings = applyFlags(library.settings, job.flags);
  const schedule = chooseSchedule(library, job.schedule);
  const dates = airingDates(schedule, job.from ?? localIsoDate(new Date()), job.days);

  console.log(`Biblioteca: ${libraryDir}`);
  console.log(`Grade: ${schedule.id === AUTO_SCHEDULE_ID ? 'Canal Automático (a biblioteca não tem grades)' : schedule.name}`);
  console.log(`Dias: ${plural(dates.length, 'dia')} de exibição, de ${formatDate(dates[0]!)} (${weekdayName(dates[0]!)}) a ${formatDate(dates.at(-1)!)} (${weekdayName(dates.at(-1)!)})`);
  if (library.warnings.length > 0) console.log(`Avisos da biblioteca: ${library.warnings.length} (veja com o app: Menu, Avisos)`);
  console.log('');

  const tools = await locateFfmpeg({ ffmpeg: job.ffmpeg });
  const durations = new Durations(tools, source, signal, (message) => console.log(`Aviso: ${message}`));

  process.stdout.write('Lendo as durações dos vídeos...');
  const timelines = await planTimelines(schedule, library, dates, settings, durations);
  process.stdout.write(' pronto.\n');
  if (signal.aborted) return interrupted(false);

  const used = timelines.flatMap(({ timeline }) => timeline.entries.filter((entry) => entry.path !== undefined && entry.kind !== 'idle'));
  const fps = chooseFps(used.map((entry) => ({ fps: durations.infos.get(entry.path!)?.video?.frameRate ?? null, seconds: entry.duration })));
  const rundown = buildRundown(timelines, fps);
  if (rundown.days.every((day) => day.pieces.length === 0)) {
    throw new CliError('A grade não tem nada para tocar nesses dias (programas ou vídeos que faltam, ou ilegíveis). Rode sem --simular para ver os avisos, ou veja Menu, Avisos no app.');
  }
  if (rundown.skipped.length > 0) console.log(`Aviso: ${plural(rundown.skipped.length, 'arquivo')} sem duração conhecida foram pulados.`);

  const encode = encodeSettings(settings, fps, job.crf, job.preset, job.height);
  const estimates = estimate(rundown, encode);
  report(rundown, estimates, settings, encode, job.simulate);

  if (job.simulate) {
    console.log('\nModo --simular: nada foi renderizado nem gravado. Os tamanhos são estimativas.');
    return 0;
  }

  // ---- go
  const target = destination!;
  const total = estimates.reduce((sum, day) => sum + day.bytes, 0);
  const libraryBytes = job.copyLibrary ? await libraryBytesOf(source, library.root) : 0;
  await checkSpace(target, total, Math.max(...estimates.map((day) => day.bytes)), libraryBytes);

  const maxParts = Math.max(...estimates.map((day) => day.parts.length));
  const naming = partNaming(rundown.days.length, maxParts * 2);
  console.log('');
  const result = await renderRundown({ tools, signal, source, destination: target, rundown, encode, infos: durations.infos, naming, concurrency: job.concurrency });
  if (result.interrupted) return interrupted(true);

  // ---- notes, library copy, cleanup
  const days = rundown.days
    .map((day) => ({
      number: day.number,
      date: day.date,
      seconds: day.seconds,
      parts: result.parts.filter((part) => part.day === day.number).map((part) => ({ name: part.name, bytes: part.bytes, seconds: part.seconds })),
    }))
    .filter((day) => day.parts.length > 0);

  let copied: Awaited<ReturnType<typeof copyLibrary>> | null = null;
  if (job.copyLibrary) {
    console.log(`\nCopiando a biblioteca para ${path.join(target, LIBRARY_FOLDER)}...`);
    copied = await copyLibrary(source, library.root, target, signal, (file, done, count) => {
      if (process.stdout.isTTY) process.stdout.write(`\r  ${done}/${count} ${file}`.slice(0, (process.stdout.columns ?? 100) - 1) + '\x1b[K');
    });
    if (process.stdout.isTTY) process.stdout.write('\r\x1b[K');
    if (copied.interrupted) return interrupted(true);
  }

  const readme = buildReadme({
    generatedAt: new Date(),
    scheduleName: schedule.id === AUTO_SCHEDULE_ID ? 'Canal Automático' : schedule.name,
    days,
    crt: encode.crt,
    interstitials: settings.interstitials,
    commercials: settings.commercials,
    adBreaks: settings.adBreaks,
    aspect: settings.aspect,
    fps,
    height: encode.height,
    libraryCopied: copied !== null && copied.failures.length === 0,
  });
  await writeFile(await destPath(target, README_FILE), readme, 'utf8');

  const failed = result.failures.length > 0 || (copied?.failures.length ?? 0) > 0;
  if (!failed) await removeTemp(target);
  await summary(target, rundown, result, copied, failed);
  return failed ? 1 : 0;
}

function interrupted(kept: boolean): number {
  console.log('\nInterrompido. Arquivos pela metade foram apagados.');
  if (kept) console.log(`O que já estava renderizado ficou guardado em ${TEMP_FOLDER}/; rode o mesmo comando de novo para continuar de onde parou.`);
  return 130;
}

// ---------------------------------------------------------------- estimates and report

interface DayEstimate {
  day: RundownDay;
  bytes: number;
  parts: { start: number; end: number; bytes: number; oversize: boolean }[];
  sizes: number[];
}

function estimate(rundown: Rundown, encode: EncodeSettings): DayEstimate[] {
  return rundown.days.map((day) => {
    const sizes = day.pieces.map((piece) => estimateSize(piece.seconds, encode));
    return { day, sizes, bytes: sizes.reduce((sum, size) => sum + size, 0), parts: splitParts(day.pieces, sizes, PART_TARGET_BYTES) };
  });
}

const clock = (seconds: number) => {
  const total = Math.round(seconds);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${pad(Math.floor(total / 3600))}:${pad(Math.floor((total % 3600) / 60))}:${pad(total % 60)}`;
};

function report(rundown: Rundown, estimates: DayEstimate[], settings: Settings, encode: EncodeSettings, detailed: boolean) {
  for (const line of settingsSummary({ crt: encode.crt, interstitials: settings.interstitials, commercials: settings.commercials, adBreaks: settings.adBreaks, aspect: settings.aspect, fps: rundown.fps, height: encode.height })) {
    console.log(`  ${line}`);
  }
  console.log('');
  const naming = partNaming(rundown.days.length, Math.max(...estimates.map((day) => day.parts.length)) * 2);
  for (const { day, parts, bytes, sizes } of estimates) {
    const ads = day.pieces.filter((piece) => piece.role === 'comercial').length;
    console.log(
      `Dia ${day.number}: ${weekdayName(day.date)}, ${formatDate(day.date)}: ${plural(day.pieces.length, 'item', 'itens')}, ${formatDuration(day.seconds)}, ` +
        `~${formatBytes(bytes)} em ${plural(parts.length, 'parte')}`,
    );
    if (!detailed) continue;
    const startsOfPart = new Map(parts.map((part, index) => [part.start, index]));
    const endsOfPart = new Map(parts.map((part, index) => [part.end, index]));
    for (const [i, piece] of day.pieces.entries()) {
      const part = startsOfPart.get(i);
      if (part !== undefined) console.log(`  ── ${partFileName(day.number, part + 1, naming)} ──`);
      const role = piece.role === 'episodio' ? 'episódio ' : piece.role === 'comercial' ? 'comercial' : 'vinheta  ';
      const mark = piece.inBreak ? '  ' : '';
      console.log(`  ${clock(piece.offset)}  ${role}  ${mark}${describe(piece, false)}  (${formatDuration(piece.seconds)}, ~${formatBytes(sizes[i]!)})`);
      const ended = endsOfPart.get(i + 1);
      if (ended !== undefined) {
        const range = parts[ended]!;
        console.log(`  ── fim de ${partFileName(day.number, ended + 1, naming)}: ${plural(range.end - range.start, 'item', 'itens')}, ~${formatBytes(range.bytes)}${range.oversize ? ' (maior que o limite: um vídeo só passa disso)' : ''} ──`);
      }
    }
    if (ads > 0) console.log(`  (${plural(ads, 'comercial', 'comerciais')} no dia)`);
    console.log('');
  }
  if (!detailed) console.log('');
  const total = estimates.reduce((sum, day) => sum + day.bytes, 0);
  const parts = estimates.reduce((sum, day) => sum + day.parts.length, 0);
  console.log(`Total: ${plural(rundown.days.length, 'dia')}, ${formatDuration(rundown.days.reduce((sum, day) => sum + day.seconds, 0))}, ~${formatBytes(total)} em ${plural(parts, 'arquivo')} (estimativa).`);
}

// ---------------------------------------------------------------- disk space

async function libraryBytesOf(source: NodeLibrarySource, root: string): Promise<number> {
  let bytes = 0;
  for (const file of source.files) {
    if (!file.startsWith(root)) continue;
    bytes += (await stat(source.resolve(file)).catch(() => null))?.size ?? 0;
  }
  return bytes;
}

/** Warns (never blocks) when the destination looks too small: the result, the work folder for one day and the library copy. */
async function checkSpace(destination: string, finalBytes: number, largestDay: number, libraryBytes: number): Promise<void> {
  await mkdir(destination, { recursive: true });
  let free: number;
  try {
    const info = await statfs(destination);
    free = Number(info.bavail) * Number(info.bsize);
  } catch {
    return; // this system can't tell: not worth stopping for
  }
  // The pieces of a day live next to the finished files until the day is joined.
  const needed = Math.round((finalBytes + largestDay + libraryBytes) * 1.05);
  console.log(`Espaço livre em ${destination}: ${formatBytes(free)}. Previsto: ~${formatBytes(needed)}${libraryBytes > 0 ? ` (com a cópia da biblioteca, ${formatBytes(libraryBytes)})` : ''}.`);
  if (free < needed) {
    console.log(
      `AVISO: o espaço livre parece menor que o necessário (faltam ~${formatBytes(needed - free)}). Se acabar o espaço no meio, o comando para com erro ` +
        `e o que já foi gerado fica guardado. Libere espaço, gere menos dias (--dias) ou use --sem-crt para arquivos menores.`,
    );
  }
}

// ---------------------------------------------------------------- end

async function summary(
  destination: string,
  rundown: Rundown,
  result: Awaited<ReturnType<typeof renderRundown>>,
  copied: Awaited<ReturnType<typeof copyLibrary>> | null,
  failed: boolean,
) {
  const bytes = result.parts.reduce((sum, part) => sum + part.bytes, 0);
  const seconds = result.parts.reduce((sum, part) => sum + part.seconds, 0);
  const days = new Set(result.parts.map((part) => part.day)).size;
  console.log('\nResumo');
  console.log(`  Dias: ${days} de ${rundown.days.length}`);
  console.log(`  Arquivos: ${result.parts.length} (${formatBytes(bytes)}, ${formatDuration(seconds)} de programação)`);
  console.log(`  Tempo: ${formatDuration(result.elapsedMs / 1000)}${result.renderedSeconds > 0 ? ` (${(result.renderedSeconds / (result.elapsedMs / 1000)).toFixed(1).replace('.', ',')}x o tempo real)` : ''}`);
  if (result.oversize.length > 0) console.log(`  Atenção: ${result.oversize.join(', ')} passa de ${formatBytes(PART_TARGET_BYTES)} porque um vídeo só é maior que isso; pode não caber em FAT32.`);
  if (copied) {
    if (copied.sameFolder) console.log('  Biblioteca: o pendrive já é a pasta da biblioteca, nada a copiar.');
    else console.log(`  Biblioteca: ${plural(copied.copied, 'arquivo')} copiados (${formatBytes(copied.bytes)}), ${copied.skipped} já estavam lá.`);
    for (const failure of copied.failures.slice(0, 5)) console.log(`    falhou: ${failure.file}: ${failure.message}`);
  }
  for (const failure of result.failures) console.log(`  Item pulado: ${failure.piece}: ${failure.message}`);

  // Files of an older run that this one did not produce would play along with the new ones.
  const produced = new Set(result.parts.map((part) => part.name.toLowerCase()));
  const folder = await destPath(destination, PLAY_FOLDER);
  const stale = (await readdir(folder).catch(() => [] as string[])).filter((name) => isPartFileName(name) && !produced.has(name.toLowerCase()));
  if (stale.length > 0) {
    console.log(`\nAtenção: ${plural(stale.length, 'arquivo')} de uma geração anterior continua em "${PLAY_FOLDER}" e vai tocar junto: ${stale.slice(0, 6).join(', ')}${stale.length > 6 ? '...' : ''}.`);
    console.log('Apague-os se não quiser.');
  }
  console.log(`\n${failed ? 'Terminou com problemas.' : 'Pronto!'} Os vídeos estão em ${path.join(destination, PLAY_FOLDER)}`);
  if (failed) console.log(`A pasta ${TEMP_FOLDER} foi mantida; rode o comando de novo para tentar o que falhou.`);
  else console.log('Coloque o pendrive na TV, abra a pasta e toque o primeiro arquivo. Veja o LEIA-ME.txt.');
}
