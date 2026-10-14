// LEIA-ME.txt, the note that goes on the pendrive: how to play it on a TV, what is inside and how it was made.

import { formatBytes, formatDuration } from '../ui';
import { formatDate, weekdayName } from './calendar';
import type { CrtLook } from './crt';
import { LIBRARY_FOLDER, PLAY_FOLDER } from './names';
import type { Aspect } from './segment';

export interface ReadmePart {
  name: string;
  bytes: number;
  seconds: number;
}

export interface ReadmeDay {
  number: number;
  date: string;
  seconds: number;
  parts: ReadmePart[];
}

export interface ReadmeInput {
  generatedAt: Date;
  scheduleName: string;
  days: ReadmeDay[];
  /** The CRT look, or null when it is off. */
  crt: CrtLook | null;
  interstitials: boolean;
  commercials: boolean;
  adBreaks: { every: number; ads: number; afterEpisode: boolean };
  aspect: Aspect;
  fps: number;
  /** `--copiar-biblioteca` was used. */
  libraryCopied: boolean;
}

const INTENSITY = { soft: 'suave', medium: 'média', strong: 'forte' } as const;
const ASPECT = {
  '4:3': 'imagem 4:3 com barras pretas nas laterais',
  stretch: 'imagem esticada para preencher a tela',
  original: 'proporção original do vídeo',
} as const;

const yesNo = (value: boolean) => (value ? 'sim' : 'não');

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

/** The settings as readable lines, shared by the note and the console summary. */
export function settingsSummary(input: Omit<ReadmeInput, 'generatedAt' | 'scheduleName' | 'days' | 'libraryCopied'>): string[] {
  const lines: string[] = [];
  if (input.crt) {
    lines.push(`Efeito de TV de tubo (CRT): ligado, intensidade ${INTENSITY[input.crt.intensity]}, curvatura ${input.crt.curvature}%, linhas de varredura ${yesNo(input.crt.scanlines)}`);
  } else {
    lines.push('Efeito de TV de tubo (CRT): desligado');
  }
  lines.push(`Vinhetas: ${yesNo(input.interstitials)}`);
  if (input.commercials) {
    const { every, ads, afterEpisode } = input.adBreaks;
    const middle = every > 0 ? `a cada ${every} minutos de episódio` : 'sem cortes no meio dos episódios';
    lines.push(`Comerciais: sim (${ads} por intervalo, ${middle}, intervalo ao fim do episódio: ${yesNo(afterEpisode)})`);
  } else {
    lines.push('Comerciais: não');
  }
  lines.push(`Proporção: ${ASPECT[input.aspect]}`);
  lines.push(`Vídeo: 1280x720, ${input.fps} quadros por segundo; som estéreo com volume igualado entre episódios, vinhetas e comerciais`);
  return lines;
}

export function buildReadme(input: ReadmeInput): string {
  const when = input.generatedAt;
  const stamp = `${pad(when.getDate())}/${pad(when.getMonth() + 1)}/${when.getFullYear()} ${pad(when.getHours())}:${pad(when.getMinutes())}`;
  const totalBytes = input.days.reduce((sum, day) => sum + day.parts.reduce((inner, part) => inner + part.bytes, 0), 0);
  const totalSeconds = input.days.reduce((sum, day) => sum + day.seconds, 0);

  const lines: string[] = [
    'TV CHUVISCO - PENDRIVE',
    '======================',
    '',
    `Programação: ${input.scheduleName}`,
    `${input.days.length} ${input.days.length === 1 ? 'dia' : 'dias'}, ${formatDuration(totalSeconds)} de programação, ${formatBytes(totalBytes)}.`,
    '',
    'COMO ASSISTIR NA TV',
    '-------------------',
    '1. Ligue o pendrive na porta USB da TV.',
    '2. Na TV, troque a fonte (entrada) para USB. Em algumas TVs o nome é "Mídia", "Multimídia" ou "Reprodutor".',
    `3. Abra a pasta "${PLAY_FOLDER}" e toque o primeiro arquivo: "${input.days[0]?.parts[0]?.name ?? 'Dia 01 - Parte 1.mp4'}".`,
    '4. Quando o arquivo acabar, toque o próximo da lista (os nomes já estão na ordem certa). Muitas TVs passam para o',
    '   próximo sozinhas; se a sua não faz isso, procure a opção de repetir ou tocar toda a pasta.',
    '',
    'A programação começa do início quando você aperta play: não há relógio ao vivo. Cada dia traz episódios diferentes,',
    'na ordem em que passariam na TV.',
    '',
    'O QUE TEM AQUI',
    '--------------',
  ];
  for (const day of input.days) {
    lines.push(`Dia ${pad(day.number)} - ${weekdayName(day.date)}, ${formatDate(day.date)} (${formatDuration(day.seconds)})`);
    for (const part of day.parts) lines.push(`    ${part.name}  (${formatDuration(part.seconds)}, ${formatBytes(part.bytes)})`);
  }
  lines.push(
    '',
    'Cada dia é dividido em partes de menos de 4 GB, porque pendrives em FAT32 não aceitam arquivos maiores.',
    'As partes terminam, sempre que possível, logo depois de um intervalo comercial.',
    '',
    'COMO FOI GERADO',
    '---------------',
    ...settingsSummary(input).map((line) => `${line}.`),
    '',
    'Para mudar qualquer uma dessas opções (por exemplo, tirar o efeito de TV de tubo), é preciso gerar o pendrive de novo,',
    'com o comando "tv-chuvisco pendrive" (veja docs/pendrive.md no projeto).',
    '',
  );
  if (input.libraryCopied) {
    lines.push(
      'TV BOX COM O APLICATIVO',
      '-----------------------',
      `A pasta "${LIBRARY_FOLDER}" é uma cópia da biblioteca. O aplicativo TV Chuvisco, numa TV Box, usa essa pasta e oferece`,
      'a experiência completa (relógio, canais, configurações). Numa TV comum, ignore essa pasta.',
      '',
    );
  }
  lines.push(
    'SOBRE O PROJETO',
    '---------------',
    `Gerado pelo TV Chuvisco em ${stamp}.`,
    'O TV Chuvisco é software livre (licença GPL-3.0) e independente: não tem nenhuma ligação com a TV Globo nem com',
    'qualquer outra emissora. "TV Globinho" é citada apenas para descrever o estilo da programação que ele simula.',
    'Os vídeos que estão neste pendrive vêm da biblioteca de quem o gerou.',
    '',
  );
  return lines.join('\r\n');
}
