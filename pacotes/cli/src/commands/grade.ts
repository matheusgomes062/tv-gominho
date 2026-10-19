import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  DEFAULT_GENERATE_BLOCK,
  WEEKDAYS,
  formatTimeOfDay,
  generateSchedule,
  localIsoDate,
  parseTimeOfDay,
  resolveInterstitials,
  scanLibrary,
  scheduleToYaml,
  type GenerateBlock,
  type Weekday,
} from '@tv-gominho/nucleo';
import { Durations } from '../durations';
import { CliError, UsageError } from '../errors';
import { locateFfmpeg } from '../ffmpeg';
import { openNodeLibrary } from '../node-source';
import { ffmpegOptions, helpOptions, intOption, parseOptions } from '../options';
import { isIsoDate } from '../pendrive/calendar';
import { formatDuration, plural } from '../ui';
import type { Command, CommandContext } from './types';

const OPTIONS = {
  ...helpOptions,
  ...ffmpegOptions,
  nome: { type: 'string' },
  programas: { type: 'string', short: 'p' },
  blocos: { type: 'string', short: 'b' },
  epoca: { type: 'string', short: 'e' },
  marca: { type: 'string' },
  dias: { type: 'string' },
  'a-partir-de': { type: 'string' },
  arquivo: { type: 'string' },
  substituir: { type: 'boolean' },
  simular: { type: 'boolean' },
} as const;

const DEFAULT_FILE = 'tv-globinho';

const HELP = `Uso:
  tv-gominho grade <biblioteca> [opções]

Monta uma grade no estilo da TV Globinho com o que está na biblioteca e grava em
grades/${DEFAULT_FILE}.yaml. Cada bloco começa com uma abertura, passa os programas
em rodízio (com chamadas entre eles, se houver em vinhetas/chamadas) e termina com um
encerramento. O tamanho do bloco já conta os intervalos comerciais e as vinhetas de
intervalo, conforme o configuracoes.yaml. Desenhos curtos (menos de 13 minutos)
passam dois episódios seguidos.

A grade gerada é um arquivo comum: dá para abrir e editar à vontade (veja docs/grade.md).

Opções:
  --nome <texto>              nome do canal. Padrão: "TV Globinho"
  --programas, -p a,b,c       pastas dos programas, na ordem do rodízio.
                              Padrão: todos os programas com episódios
  --blocos, -b <horários>     blocos e duração, como "08:00-12:00" ou "08:00-10:00,14:00-17:30".
                              Padrão: ${formatTimeOfDay(DEFAULT_GENERATE_BLOCK.start)}-${formatTimeOfDay(DEFAULT_GENERATE_BLOCK.start + DEFAULT_GENERATE_BLOCK.length)}
  --epoca, -e <ano>           escolhe a abertura, o encerramento e as vinhetas de intervalo daquele
                              ano, pelo ano no nome da pasta ou do arquivo ("2003-2009", "(2011)")
  --marca <palavra>           prefere as vinhetas com essa palavra no caminho. Padrão: globinho.
                              --marca "" aceita qualquer marca
  --dias seg,ter,...          dias da semana. Padrão: seg,ter,qua,qui,sex
  --a-partir-de AAAA-MM-DD    estreia da grade (o primeiro episódio passa nesse dia). Padrão: hoje
  --arquivo <nome>            nome do arquivo em grades/. Padrão: ${DEFAULT_FILE}
  --substituir                grava por cima se o arquivo já existe
  --simular                   só mostra a grade, sem gravar
  --ffmpeg <caminho>          ffmpeg a usar, para ler a duração dos vídeos. Sem ffmpeg, a
                              grade usa durações típicas (22 minutos por episódio)
  --ajuda                     mostra esta ajuda

Exemplos:
  tv-gominho grade ./biblioteca --epoca 2004 --simular
  tv-gominho grade ./biblioteca --epoca 2010 -b 08:00-12:00 --arquivo tv-globinho-2010
  tv-gominho grade ./biblioteca -p dragon-ball-z,pokemon,digimon -b 08:00-10:00,10:30-12:00`;

export const gradeCommand: Command = {
  name: 'grade',
  summary: 'Monta uma grade no estilo TV Globinho com os programas da biblioteca',
  help: HELP,
  async run(argv, context) {
    const { values, positionals } = parseOptions(argv, OPTIONS);
    if (values.ajuda) {
      console.log(HELP);
      return 0;
    }
    if (positionals.length !== 1) throw new UsageError('Informe a pasta da biblioteca: tv-gominho grade <biblioteca>. Veja "tv-gominho grade --ajuda".');
    const from = values['a-partir-de'];
    if (from !== undefined && !isIsoDate(from)) throw new UsageError(`--a-partir-de precisa ser uma data no formato AAAA-MM-DD (recebi "${from}").`);
    const file = values.arquivo ?? DEFAULT_FILE;
    if (!/^[a-z0-9][a-z0-9-]*$/i.test(file)) throw new UsageError(`--arquivo deve ter só letras, números e hífens, como "${DEFAULT_FILE}" (recebi "${file}").`);

    return grade(
      {
        folder: positionals[0]!,
        name: values.nome,
        shows: values.programas ? list(values.programas) : undefined,
        blocks: values.blocos !== undefined ? parseBlocks(values.blocos) : undefined,
        era: intOption('--epoca', values.epoca, 1950, 2100),
        brand: values.marca,
        days: values.dias !== undefined ? parseDays(values.dias) : undefined,
        startDate: from ?? localIsoDate(new Date()),
        file,
        replace: Boolean(values.substituir),
        simulate: Boolean(values.simular),
        ffmpeg: values.ffmpeg,
      },
      context,
    );
  },
};

const list = (text: string) => text.split(',').map((part) => part.trim()).filter(Boolean);

/** "08:00-12:00,14:00-16:30" -> blocks; the end may pass midnight ("22:00-01:00"). */
export function parseBlocks(text: string): GenerateBlock[] {
  const parts = list(text);
  if (parts.length === 0) throw new UsageError('--blocos precisa de pelo menos um bloco, como "08:00-12:00".');
  const blocks = parts.map((part) => {
    const [startText, endText, extra] = part.split('-').map((piece) => piece.trim());
    const start = parseTimeOfDay(startText ?? '');
    const end = parseTimeOfDay(endText ?? '');
    if (start === null || end === null || extra !== undefined || start === end) {
      throw new UsageError(`Bloco inválido: "${part}". Use início-fim, como "08:00-12:00".`);
    }
    return { start, length: end > start ? end - start : end + 86_400 - start };
  });
  blocks.sort((a, b) => a.start - b.start);
  blocks.forEach((block, i) => {
    const next = blocks[i + 1];
    if (next && block.start + block.length > next.start) {
      throw new UsageError(`Os blocos ${formatTimeOfDay(block.start)} e ${formatTimeOfDay(next.start)} se sobrepõem.`);
    }
  });
  return blocks;
}

function parseDays(text: string): Weekday[] {
  const days = list(text).map((day) => day.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').slice(0, 3));
  const wrong = days.filter((day) => !WEEKDAYS.includes(day as Weekday));
  if (days.length === 0 || wrong.length > 0) throw new UsageError(`--dias aceita dom, seg, ter, qua, qui, sex e sab (recebi "${text}").`);
  return WEEKDAYS.filter((day) => days.includes(day));
}

interface Job {
  folder: string;
  name: string | undefined;
  shows: string[] | undefined;
  blocks: GenerateBlock[] | undefined;
  era: number | undefined;
  brand: string | undefined;
  days: Weekday[] | undefined;
  startDate: string;
  file: string;
  replace: boolean;
  simulate: boolean;
  ffmpeg: string | undefined;
}

async function grade(job: Job, { signal }: CommandContext): Promise<number> {
  const source = await openNodeLibrary(job.folder);
  const library = await scanLibrary(source);
  const shows = library.shows.filter((show) => show.episodes.length > 0);
  if (shows.length === 0) throw new CliError(`"${source.dir}" não tem programas com episódios em programas/ (veja docs/biblioteca.md).`);
  const target = `${library.root}grades/${job.file}.yaml`;
  const exists = source.files.some((file) => file.toLowerCase() === target.toLowerCase());
  if (exists && !job.replace && !job.simulate) {
    throw new CliError(`grades/${job.file}.yaml já existe. Use --substituir para gravar por cima, ou --arquivo com outro nome.`);
  }

  // Durations make the blocks end on time; without ffmpeg, typical lengths do.
  let durationOf: (file: string) => number | undefined = () => undefined;
  try {
    const tools = await locateFfmpeg({ ffmpeg: job.ffmpeg });
    const durations = new Durations(tools, source, signal, (message) => console.log(`Aviso: ${message}`));
    const wanted = new Set(job.shows?.map((id) => id.toLowerCase()) ?? shows.map((show) => show.id.toLowerCase()));
    const paths = [
      ...shows.filter((show) => wanted.has(show.id.toLowerCase())).flatMap((show) => show.episodes.slice(0, 12).map((episode) => episode.path)),
      ...library.interstitials.map((item) => item.path),
    ];
    process.stdout.write(`Lendo a duração de ${plural(paths.length, 'vídeo')}...`);
    await durations.load(paths);
    process.stdout.write(' pronto.\n');
    if (signal.aborted) return 130;
    durationOf = durations.get;
  } catch (error) {
    if (job.ffmpeg !== undefined) throw error;
    console.log('Aviso: não achei o ffmpeg; uso durações típicas (22 minutos por episódio, 30 segundos por comercial).');
  }

  let generated;
  try {
    generated = generateSchedule(library, durationOf, {
      name: job.name,
      description: job.era ? `Grade montada com as vinhetas de ${job.era}.` : undefined,
      shows: job.shows,
      brand: job.brand,
      era: job.era,
      blocks: job.blocks,
      days: job.days,
      startDate: job.startDate,
    });
  } catch (error) {
    throw new CliError((error as Error).message);
  }
  const yaml = scheduleToYaml(generated, [
    `Gerada por "tv-gominho grade" em ${localIsoDate(new Date())}. Pode editar à vontade (veja docs/grade.md).`,
    'Os horários nos comentários são estimativas, com os intervalos comerciais.',
  ]);

  const { schedule, estimates } = generated;
  console.log('');
  console.log(yaml);
  for (const [category, label] of [['aberturas', 'abertura'], ['encerramentos', 'encerramento'], ['chamadas', 'chamada']] as const) {
    if (resolveInterstitials(library, category).length === 0) console.log(`Sem ${label}: a pasta vinhetas/${category}/ está vazia.`);
  }
  if (!schedule.breakBumpersRef) console.log('Vinhetas de intervalo: sorteadas por dia entre as subpastas de vinhetas/intervalos/.');
  schedule.blocks.forEach((block, i) => {
    const count = block.items.filter((item) => item.type === 'show').length;
    console.log(`Bloco das ${formatTimeOfDay(block.start)}: ${plural(count, 'programa')}, ~${formatDuration(estimates[i]!)} com os intervalos.`);
  });

  if (job.simulate) {
    console.log('\nModo --simular: nada foi gravado.');
    return 0;
  }
  const output = await source.resolveForWrite(target);
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, yaml, 'utf8');
  console.log(`\nGravada em ${output}. Ela aparece como o canal "${schedule.name}" no app.`);
  return 0;
}
