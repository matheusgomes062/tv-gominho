#!/usr/bin/env node
// Generates a small sample library in exemplo/biblioteca with test-pattern
// videos, so anyone can try TV Chuvisco without real episodes.
//
//   npm run exemplo
//
// Needs ffmpeg on the PATH (or set FFMPEG=/path/to/ffmpeg).

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'exemplo', 'biblioteca');
const marker = path.join(out, '.gerado-pelo-tv-chuvisco');
const ffmpeg = process.env.FFMPEG ?? 'ffmpeg';

const FONTS = [
  'C:/Windows/Fonts/arialbd.ttf',
  'C:/Windows/Fonts/arial.ttf',
  '/System/Library/Fonts/Supplemental/Arial Bold.ttf',
  '/System/Library/Fonts/Supplemental/Arial.ttf',
  '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
  '/usr/share/fonts/TTF/DejaVuSans-Bold.ttf',
  '/usr/share/fonts/dejavu/DejaVuSans-Bold.ttf',
];
const font = FONTS.find((file) => existsSync(file));
// ffmpeg filter syntax: the drive-letter colon must be escaped.
const fontOption = font ? `fontfile='${font.replace(/:/g, '\\:')}':` : '';

function run(args) {
  const result = spawnSync(ffmpeg, ['-v', 'error', '-y', ...args], { stdio: ['ignore', 'inherit', 'inherit'] });
  if (result.error?.code === 'ENOENT') {
    console.error('ffmpeg não encontrado. Instale o ffmpeg ou defina a variável FFMPEG com o caminho dele.');
    process.exit(1);
  }
  if (result.status !== 0) {
    console.error(`ffmpeg falhou: ${args.join(' ')}`);
    process.exit(1);
  }
}

/** Text overlay; ':' and "'" can't appear in the text without heavy escaping. */
function text(content, { size = 48, y = '(h-text_h)/2', color = 'white', box = true } = {}) {
  const safe = content.replace(/[:'\\]/g, ' ');
  const boxOptions = box ? ':box=1:boxcolor=black@0.55:boxborderw=14' : '';
  return `drawtext=${fontOption}text='${safe}':fontsize=${size}:fontcolor=${color}:x=(w-text_w)/2:y=${y}${boxOptions}`;
}

function file(relative, content) {
  const target = path.join(out, relative);
  mkdirSync(path.dirname(target), { recursive: true });
  if (content !== undefined) writeFileSync(target, content);
  return target;
}

/** A test-pattern video with a title, a clock and a tone. */
function video(relative, { title, subtitle = '', seconds, source = 'testsrc2', tone = 440 }) {
  const input =
    source === 'testsrc2'
      ? `testsrc2=size=640x480:rate=25:duration=${seconds}`
      : source === 'smpte'
        ? `smptebars=size=640x480:rate=25:duration=${seconds}`
        : `color=c=${source}:size=640x480:rate=25:duration=${seconds}`;
  const filters = [
    text(title, { size: 44, y: 'h*0.30' }),
    subtitle && text(subtitle, { size: 30, y: 'h*0.30+70' }),
    `drawtext=${fontOption}text='%{pts\\:hms}':fontsize=26:fontcolor=yellow:x=w-text_w-16:y=h-text_h-16:box=1:boxcolor=black@0.5:boxborderw=8`,
  ].filter(Boolean);
  run([
    '-f', 'lavfi', '-i', input,
    '-f', 'lavfi', '-i', `sine=frequency=${tone}:sample_rate=48000:duration=${seconds}`,
    '-vf', filters.join(','),
    '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', '-profile:v', 'high',
    '-c:a', 'aac', '-b:a', '96k',
    '-movflags', '+faststart', '-shortest',
    file(relative),
  ]);
}

function image(relative, { title, color, width, height }) {
  run([
    '-f', 'lavfi', '-i', `color=c=${color}:size=${width}x${height}`,
    '-frames:v', '1',
    '-vf', text(title, { size: Math.round(width / 9), box: false }),
    file(relative),
  ]);
}

// Start fresh, but never delete a folder this script didn't create.
if (existsSync(out)) {
  if (!existsSync(marker)) {
    console.error(`${out} já existe e não foi criada por este script. Apague ou renomeie a pasta antes.`);
    process.exit(1);
  }
  rmSync(out, { recursive: true, force: true });
}
file('.gerado-pelo-tv-chuvisco', 'Biblioteca de exemplo gerada por scripts/gerar-exemplo.mjs. Pode apagar.\n');
console.log(`Gerando biblioteca de exemplo em ${out}`);
if (!font) console.log('Aviso: nenhuma fonte encontrada; os vídeos ficarão sem texto.');

const EPISODE_SECONDS = 20;

// Show 1: seasons, episodios.yaml, poster and backdrop.
file('programas/turma-do-teste/programa.yaml', `titulo: A Turma do Teste
titulo_original: Test Pattern Gang
ano: 1999
descricao: Uma turma de barras coloridas vive aventuras no padrão de teste da emissora.
classificacao: Livre
`);
file('programas/turma-do-teste/episodios.yaml', `"temporada-01/001":
  titulo: O Primeiro Sinal
  descricao: A turma descobre que está no ar pela primeira vez.
"temporada-01/002":
  titulo: Fora de Sintonia
"temporada-02/001":
  titulo: A Volta da Turma
`);
image('programas/turma-do-teste/capa.png', { title: 'Turma do Teste', color: '0x2a4fd6', width: 400, height: 600 });
image('programas/turma-do-teste/fundo.png', { title: 'Turma do Teste', color: '0x18307f', width: 1280, height: 720 });
video('programas/turma-do-teste/episodios/temporada-01/001 - O Primeiro Sinal.mp4', { title: 'A Turma do Teste', subtitle: 'T1 Ep 1', seconds: EPISODE_SECONDS, tone: 330 });
video('programas/turma-do-teste/episodios/temporada-01/002.mp4', { title: 'A Turma do Teste', subtitle: 'T1 Ep 2', seconds: EPISODE_SECONDS, tone: 350 });
video('programas/turma-do-teste/episodios/temporada-02/001.mp4', { title: 'A Turma do Teste', subtitle: 'T2 Ep 1', seconds: EPISODE_SECONDS, tone: 370 });
video('programas/turma-do-teste/episodios/temporada-02/002 - O Grande Final.mp4', { title: 'A Turma do Teste', subtitle: 'T2 Ep 2', seconds: EPISODE_SECONDS, tone: 390 });

// Show 2: no seasons, plus an old-format file that triggers a warning.
file('programas/aventuras-do-pixel/programa.yaml', `titulo: As Aventuras do Pixel
ano: 2001
descricao: Pixel, um quadradinho corajoso, atravessa a tela em busca do sinal perfeito.
`);
image('programas/aventuras-do-pixel/capa.png', { title: 'Pixel', color: '0xd6482a', width: 400, height: 600 });
for (let i = 1; i <= 3; i++) {
  video(`programas/aventuras-do-pixel/episodios/00${i} - Fase ${i}.mp4`, {
    title: 'As Aventuras do Pixel',
    subtitle: `Episódio ${i}`,
    seconds: EPISODE_SECONDS,
    source: ['0x7a1f12', '0x12507a', '0x3d7a12'][i - 1],
    tone: 500 + i * 40,
  });
}
run([
  '-f', 'lavfi', '-i', 'testsrc=size=320x240:rate=25:duration=2',
  '-c:v', 'mpeg4', file('programas/aventuras-do-pixel/episodios/004 - Formato Antigo.avi'),
]);

// Show 3: no poster (shows the placeholder card).
file('programas/desenho-sem-capa/programa.yaml', 'titulo: Desenho Sem Capa\n');
video('programas/desenho-sem-capa/episodios/001.mp4', { title: 'Desenho Sem Capa', subtitle: 'Episódio 1', seconds: EPISODE_SECONDS, source: '0x5a2a7a', tone: 660 });
video('programas/desenho-sem-capa/episodios/002.mp4', { title: 'Desenho Sem Capa', subtitle: 'Episódio 2', seconds: EPISODE_SECONDS, source: '0x7a2a5a', tone: 700 });

// Bumpers and commercials.
video('vinhetas/aberturas/abertura.mp4', { title: 'TV Chuvisco', subtitle: 'Abertura', seconds: 4, source: 'smpte', tone: 880 });
video('vinhetas/encerramentos/encerramento.mp4', { title: 'Até amanhã!', subtitle: 'Encerramento', seconds: 4, source: 'smpte', tone: 784 });
video('vinhetas/intervalos/voltamos-ja.mp4', { title: 'Voltamos já!', seconds: 3, source: '0xc9a000', tone: 988 });
video('vinhetas/intervalos/a-seguir.mp4', { title: 'A seguir...', seconds: 3, source: '0x00a0c9', tone: 932 });
video('vinhetas/comerciais/biscoito.mp4', { title: 'Biscoito Chuvisco', subtitle: 'Comercial', seconds: 5, source: '0x8a5a2a', tone: 262 });
video('vinhetas/comerciais/brinquedo.mp4', { title: 'Robô de Pilha', subtitle: 'Comercial', seconds: 5, source: '0x2a8a5a', tone: 294 });

// Schedules: two channels.
file('grades/1-manha-de-teste.yaml', `nome: Manhã de Teste
descricao: Grade de exemplo. Gerada por scripts/gerar-exemplo.mjs.
data_inicio: 2026-01-05
dias: [seg, ter, qua, qui, sex]

blocos:
  - horario: "08:00"
    itens:
      - vinheta: aberturas
      - programa: turma-do-teste
      - vinheta: intervalos
      - comerciais: 2
      - programa: aventuras-do-pixel

  # Um minuto e pouco depois: o espaço é preenchido com vinhetas e comerciais.
  - horario: "08:03"
    itens:
      - vinheta: intervalos
      - programa: desenho-sem-capa
      - programa: aventuras-do-pixel
      - vinheta: encerramentos
`);
file('grades/2-maratona.yaml', `nome: Maratona do Pixel
data_inicio: 2026-01-05

blocos:
  - horario: "00:00"
    itens:
      - vinheta: aberturas
      - programa: aventuras-do-pixel
        episodios: 3
`);

console.log('Pronto! Rode "npm run dev" e clique em "Usar biblioteca de exemplo".');
