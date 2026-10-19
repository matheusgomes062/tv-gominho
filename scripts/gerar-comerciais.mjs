#!/usr/bin/env node
// Generates a handful of FICTIONAL commercials (late-90s / early-2000s Brazilian
// kids' TV style) into <biblioteca>/vinhetas/comerciais.
//
//   npm run comerciais                      # exemplo/dominio-publico/biblioteca
//   npm run comerciais -- caminho/biblioteca
//   npm run comerciais -- --instalar-voz    # also installs the Piper voice (see below)
//
// Needs ffmpeg on the PATH (or FFMPEG=/path/to/ffmpeg). Everything is original:
// invented brands, copy and a synthesized jingle. Visuals are ffmpeg filters only.
//
// Narration (optional, the script uses the first that works):
//   1. Piper TTS (Python package `piper-tts`) with the pt_BR-faber-medium voice.
//      Voice model: https://huggingface.co/rhasspy/piper-voices (pt/pt_BR/faber/medium),
//      MODEL_CARD says the training dataset is CC0, so it is fine to use and ship audio
//      made with it. The model (~63 MB) is cached in exemplo/.cache (never in the repo).
//      Install: `python -m pip install piper-tts` or let the script create a private
//      virtualenv in exemplo/.cache/piper-venv with `npm run comerciais -- --instalar-voz`.
//   2. espeak-ng with the "pt-br" voice (winget install eSpeak-NG.eSpeak-NG), robotic but works.
//   3. No TTS: the ads are made with text and music only, and a warning is printed.

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, createWriteStream } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cache = path.join(root, 'exemplo', '.cache');
const ffmpeg = process.env.FFMPEG ?? 'ffmpeg';

const args = process.argv.slice(2);
const installVoice = args.includes('--instalar-voz');
const libraryArg = args.find((arg) => !arg.startsWith('--'));
const library = path.resolve(libraryArg ?? path.join(root, 'exemplo', 'dominio-publico', 'biblioteca'));
const out = path.join(library, 'vinhetas', 'comerciais');

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

/**
 * The commercials. Every brand, product and line of copy is invented.
 * `melodia` is a list of semitone offsets from `raiz` (Hz), one per eighth note (null = rest).
 * Per scene: `fala` is narrated, `legal` is the fast "fine print" voice, `linhas` is the
 * on-screen text, `pack` draws a product box, `selo` a starburst and `preco` a price tag.
 */
const COMERCIAIS = [
  {
    arquivo: 'recheio-pop',
    cores: ['0xff3d7f', '0xffb703'],
    raiz: 261.63, bpm: 132,
    melodia: [0, 4, 7, 4, 9, 7, 4, 0, 2, 5, 9, 5, 7, 4, 2, null],
    faixa: 'RECHEIO-POP   PEÇA JÁ PRA SUA MÃE!   ',
    fine: ['Imagens meramente ilustrativas.', 'Promoção válida enquanto durarem os estoques.'],
    cenas: [
      { fala: 'Chegou o biscoito que estoura de sabor!', linhas: ['CHEGOU O', 'BISCOITO QUE', 'ESTOURA DE SABOR!'], selo: 'LANÇAMENTO!' },
      { fala: 'Recheio-Pop! Crocante por fora, cremoso de chocolate por dentro.', linhas: ['RECHEIO-POP'], sub: ['crocante por fora,', 'cremoso por dentro!'], pack: 'RECHEIO-POP' },
      { fala: 'É o lanche mais legal da turma! Peça já pra sua mãe!', linhas: ['PEÇA JÁ', 'PRA SUA MÃE!'], preco: 'R$ 0,99' },
      { fala: 'Recheio-Pop, vai por mim, é bom do início ao fim!', linhas: ['RECHEIO-POP', 'É BOM DO INÍCIO', 'AO FIM!'], pack: 'RECHEIO-POP', legal: 'Promoção válida enquanto durarem os estoques.' },
    ],
  },
  {
    arquivo: 'bolhao-maluco',
    cores: ['0x00b4d8', '0xb5179e'],
    raiz: 293.66, bpm: 144,
    melodia: [0, 0, 7, 7, 9, 9, 7, null, 5, 5, 4, 4, 2, 2, 0, null],
    faixa: 'BOLHÃO MALUCO   FAÇA A MAIOR BOLA!   ',
    fine: ['Imagens meramente ilustrativas. Não engula o chiclete.', 'Consulte a embalagem. Válido enquanto durarem os estoques.'],
    cenas: [
      { fala: 'Você já fez uma bola do tamanho da sua cabeça?', linhas: ['UMA BOLA DO', 'TAMANHO DA', 'SUA CABEÇA?!'] },
      { fala: 'Com o chiclete Bolhão Maluco, você faz! São quatro sabores supergelados!', linhas: ['BOLHÃO MALUCO'], sub: ['4 sabores', 'supergelados!'], pack: 'BOLHÃO', selo: 'NOVO!' },
      { fala: 'Morango, uva, laranja e hortelã. Junte todos os cartões de recorde!', linhas: ['JUNTE TODOS', 'OS CARTÕES!'], preco: 'R$ 0,50' },
      { fala: 'Bolhão Maluco. Faça a maior bola da turma!', linhas: ['BOLHÃO MALUCO', 'FAÇA A MAIOR', 'BOLA DA TURMA!'], pack: 'BOLHÃO', legal: 'Promoção válida enquanto durarem os estoques.' },
    ],
  },
  {
    arquivo: 'choco-tum-tum',
    cores: ['0x6f3b1a', '0xff9e00'],
    raiz: 220, bpm: 120,
    melodia: [0, 3, 7, 10, 7, 3, 0, null, 5, 8, 12, 8, 5, 3, 0, null],
    faixa: 'CHOCO TUM-TUM   FORÇA PRA BRINCAR!   ',
    fine: ['Imagens meramente ilustrativas. Não substitui uma refeição.', 'Consuma com moderação. Dê preferência a bebida gelada.'],
    cenas: [
      { fala: 'Hora do recreio! Cadê a força pra brincar?', linhas: ['HORA DO', 'RECREIO!'] },
      { fala: 'Tem no Choco Tum-Tum! O achocolatado com leite, cálcio e muito sabor!', linhas: ['CHOCO TUM-TUM'], sub: ['com leite e cálcio!'], pack: 'TUM-TUM', selo: 'LANÇAMENTO!' },
      { fala: 'Misture no leitinho gelado ou quentinho. É só mexer: tum, tum, tum!', linhas: ['É SÓ MEXER:', 'TUM, TUM, TUM!'] },
      { fala: 'Choco Tum-Tum! Dá força pra brincar o dia inteiro!', linhas: ['CHOCO TUM-TUM', 'FORÇA PRA', 'BRINCAR!'], pack: 'TUM-TUM', legal: 'Promoção válida enquanto durarem os estoques.' },
    ],
  },
  {
    arquivo: 'robo-zigue-zague',
    cores: ['0x1d3557', '0x00f5d4'],
    raiz: 329.63, bpm: 150,
    melodia: [0, 0, 12, 0, 7, 7, 12, 7, 5, 5, 10, 5, 3, 7, 12, null],
    faixa: 'ROBÔ ZIGUE-ZAGUE   ANDA, PISCA E FAZ BARULHO!   ',
    fine: ['Pilhas não incluídas. Requer 3 pilhas AA. Imagens meramente ilustrativas.', 'Indicado para maiores de 3 anos. Cores sujeitas a alteração.'],
    cenas: [
      { fala: 'Atenção, meninos e meninas! Ele chegou!', linhas: ['ATENÇÃO!', 'ELE CHEGOU!'], selo: 'LANÇAMENTO!' },
      { fala: 'É o Robô Zigue-Zague! Ele anda pra frente, anda pra trás, pisca e faz barulho!', linhas: ['ROBÔ', 'ZIGUE-ZAGUE'], sub: ['anda, pisca', 'e faz barulho!'], pack: 'ROBÔ' },
      { fala: 'Seus amigos vão ficar de queixo caído! Peça já pra sua mãe!', linhas: ['PEÇA JÁ', 'PRA SUA MÃE!'], preco: 'R$ 29,90' },
      { fala: 'Robô Zigue-Zague! É diversão sem parar!', linhas: ['ROBÔ ZIGUE-ZAGUE', 'DIVERSÃO', 'SEM PARAR!'], pack: 'ROBÔ', legal: 'Pilhas não incluídas. Imagens meramente ilustrativas.' },
    ],
  },
  {
    arquivo: 'crocolino-bicho-cards',
    cores: ['0x38b000', '0xffd60a'],
    raiz: 246.94, bpm: 138,
    melodia: [0, 4, 7, 12, 7, 4, 7, null, 2, 5, 9, 14, 9, 5, 9, null],
    faixa: 'CROCOLINO   JUNTE TODOS OS BICHO-CARDS!   ',
    fine: ['Imagens meramente ilustrativas. 1 card em cada pacote, sorteado.', 'Coleção com 40 cards. Promoção válida enquanto durarem os estoques.'],
    cenas: [
      { fala: 'Crocolino, o salgadinho que vem com brinde!', linhas: ['CROCOLINO', 'VEM COM BRINDE!'], selo: 'NOVO!' },
      { fala: 'Em cada pacote, um Bicho-Card brilhante: leão, tartaruga, tucano e muito mais!', linhas: ['UM BICHO-CARD', 'EM CADA PACOTE!'], pack: 'CROCOLINO' },
      { fala: 'São quarenta cards para colecionar! Junte todos! Troque com os amigos!', linhas: ['JUNTE TODOS', 'OS 40 CARDS!'], preco: 'R$ 1,49' },
      { fala: 'Crocolino! Crocante, divertido e cheio de bicho!', linhas: ['CROCOLINO', 'CROCANTE E', 'CHEIO DE BICHO!'], pack: 'CROCOLINO', legal: 'Promoção válida enquanto durarem os estoques.' },
    ],
  },
  {
    arquivo: 'zap-game-portatil',
    cores: ['0x3a0ca3', '0xf72585'],
    raiz: 349.23, bpm: 160,
    melodia: [0, 7, 0, 7, 12, 7, 12, null, 3, 10, 3, 10, 15, 10, 12, null],
    faixa: 'ZAP-GAME   O VIDEOGAME DE BOLSO!   ',
    fine: ['Jogos vendidos separadamente. Pilhas não incluídas.', 'Imagens meramente ilustrativas. Ligue já: 0800 000 0000 (fictício).'],
    cenas: [
      { fala: 'Cansou de esperar a sua vez no videogame?', linhas: ['CANSOU DE', 'ESPERAR A', 'SUA VEZ?'] },
      { fala: 'Com o Zap-Game, o videogame de bolso, a diversão vai com você pra todo lado!', linhas: ['ZAP-GAME', 'O VIDEOGAME', 'DE BOLSO!'], pack: 'ZAP', selo: 'LANÇAMENTO!' },
      { fala: 'Tela colorida, som estéreo e dez jogos na memória! Ligue já e peça o seu!', linhas: ['LIGUE JÁ!', '10 JOGOS', 'NA MEMÓRIA!'], preco: '3x R$ 19,90' },
      { fala: 'Zap-Game! Joga mais, joga melhor!', linhas: ['ZAP-GAME', 'JOGA MAIS,', 'JOGA MELHOR!'], pack: 'ZAP', legal: 'Jogos vendidos separadamente. Pilhas não incluídas.' },
    ],
  },
  {
    arquivo: 'cadernos-pula-pula',
    cores: ['0xef476f', '0x06d6a0'],
    raiz: 261.63, bpm: 126,
    melodia: [0, 2, 4, 5, 7, null, 4, null, 9, 7, 5, 4, 2, 4, 0, null],
    faixa: 'PULA-PULA   VOLTA ÀS AULAS COM MUITA COR!   ',
    fine: ['Imagens meramente ilustrativas. Cores e estampas sujeitas a alteração.', 'Promoção válida enquanto durarem os estoques.'],
    cenas: [
      { fala: 'Voltou a aula, e o material tem que ser novo!', linhas: ['VOLTA ÀS', 'AULAS!'], selo: 'OFERTA!' },
      { fala: 'Os cadernos Pula-Pula têm capas coloridas, folhas bem macias e adesivos de brinde!', linhas: ['CADERNOS', 'PULA-PULA'], sub: ['capas coloridas', 'e adesivos de brinde!'], pack: 'PULA-PULA' },
      { fala: 'Tem também lápis de cor, estojo, mochila e borracha cheirosa!', linhas: ['LÁPIS, ESTOJO,', 'MOCHILA E', 'MUITO MAIS!'], preco: 'a partir de R$ 4,90' },
      { fala: 'Pula-Pula! Estudar nunca foi tão divertido!', linhas: ['PULA-PULA', 'ESTUDAR É', 'DIVERTIDO!'], pack: 'PULA-PULA', legal: 'Promoção válida enquanto durarem os estoques.' },
    ],
  },
];

const MIN_SECONDS = 16;
const MAX_SECONDS = 29;
const SCENE_PAUSE = 0.55; // silence after the narration of a scene
const SCENE_FALLBACK = 3.6; // scene length without narration

function check(command, commandArgs) {
  return spawnSync(command, commandArgs, { stdio: 'ignore' }).status === 0;
}

function run(commandArgs, cwd) {
  const result = spawnSync(ffmpeg, ['-v', 'error', '-y', ...commandArgs], { cwd, stdio: ['ignore', 'inherit', 'inherit'] });
  return result.status === 0;
}

// ---------------------------------------------------------------- narration

const PIPER_VOICE = 'pt_BR-faber-medium';
const PIPER_URL = 'https://huggingface.co/rhasspy/piper-voices/resolve/main/pt/pt_BR/faber/medium';
const venvPython = path.join(cache, 'piper-venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');

// Runs once for all lines of an ad (loading the model is the slow part).
const PIPER_HELPER = `
import json, sys, wave
from piper import PiperVoice, SynthesisConfig
model, jobs = sys.argv[1], json.load(open(sys.argv[2], encoding="utf-8"))
voice = PiperVoice.load(model)
for job in jobs:
    with wave.open(job["out"], "wb") as wav:
        voice.synthesize_wav(job["text"], wav, SynthesisConfig(length_scale=job["escala"]))
`;

function findPiperPython() {
  const candidates = [venvPython, 'python', 'python3', 'py'];
  return candidates.find((python) => (python === venvPython ? existsSync(python) : true) && check(python, ['-c', 'import piper']));
}

async function ensurePiper() {
  let python = findPiperPython();
  if (!python && installVoice) {
    const base = ['python', 'python3', 'py'].find((candidate) => check(candidate, ['--version']));
    if (!base) {
      console.log('Aviso: Python não encontrado; não foi possível instalar o Piper.');
      return undefined;
    }
    console.log('Instalando o Piper TTS num ambiente virtual em exemplo/.cache/piper-venv ...');
    mkdirSync(cache, { recursive: true });
    const ok =
      spawnSync(base, ['-m', 'venv', path.join(cache, 'piper-venv')], { stdio: 'inherit' }).status === 0 &&
      spawnSync(venvPython, ['-m', 'pip', 'install', '-q', 'piper-tts'], { stdio: 'inherit' }).status === 0;
    if (!ok) {
      console.log('Aviso: a instalação do piper-tts falhou.');
      return undefined;
    }
    python = venvPython;
  }
  if (!python) return undefined;

  const model = path.join(cache, `${PIPER_VOICE}.onnx`);
  for (const name of [`${PIPER_VOICE}.onnx`, `${PIPER_VOICE}.onnx.json`]) {
    const target = path.join(cache, name);
    if (existsSync(target)) continue;
    console.log(`Baixando a voz ${name} (licença do conjunto de dados: CC0) ...`);
    mkdirSync(cache, { recursive: true });
    try {
      const response = await fetch(`${PIPER_URL}/${name}`, { redirect: 'follow' });
      if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`);
      await pipeline(Readable.fromWeb(response.body), createWriteStream(`${target}.part`));
      const { renameSync } = await import('node:fs');
      renameSync(`${target}.part`, target);
    } catch (error) {
      console.log(`Aviso: não foi possível baixar a voz (${error.message}).`);
      rmSync(`${target}.part`, { force: true });
      return undefined;
    }
  }
  return { nome: 'Piper (pt_BR-faber-medium)', model, python };
}

function findEspeak() {
  const candidates = ['espeak-ng', 'C:/Program Files/eSpeak NG/espeak-ng.exe', 'C:/Program Files (x86)/eSpeak NG/espeak-ng.exe'];
  return candidates.find((command) => check(command, ['--version']));
}

/** Returns a function (job list, workdir) => boolean that writes the wav files, or undefined. */
async function detectTts() {
  const piper = await ensurePiper();
  if (piper) {
    return {
      nome: piper.nome,
      speak(jobs, work) {
        writeFileSync(path.join(work, 'jobs.json'), JSON.stringify(jobs));
        writeFileSync(path.join(work, 'piper.py'), PIPER_HELPER);
        const result = spawnSync(piper.python, ['-I', path.join(work, 'piper.py'), piper.model, path.join(work, 'jobs.json')], {
          stdio: ['ignore', 'ignore', 'inherit'],
        });
        return result.status === 0;
      },
    };
  }
  const espeak = findEspeak();
  if (espeak) {
    return {
      nome: 'espeak-ng (pt-br)',
      speak(jobs, work) {
        return jobs.every((job) => {
          const input = `${job.out}.txt`;
          writeFileSync(input, job.text);
          const speed = Math.round(150 / job.escala);
          return spawnSync(espeak, ['-v', 'pt-br', '-s', String(speed), '-w', job.out, '-f', input], { stdio: 'ignore' }).status === 0;
        });
      },
    };
  }
  return undefined;
}

/** Duration in seconds of a PCM wav file (walks the RIFF chunks). */
function wavSeconds(file) {
  const buffer = readFileSync(file);
  let byteRate = 0;
  let offset = 12;
  while (offset + 8 <= buffer.length) {
    const id = buffer.toString('ascii', offset, offset + 4);
    let size = buffer.readUInt32LE(offset + 4);
    if (id === 'fmt ') byteRate = buffer.readUInt32LE(offset + 16);
    if (id === 'data') {
      if (size === 0xffffffff || offset + 8 + size > buffer.length) size = buffer.length - offset - 8;
      return byteRate ? size / byteRate : 0;
    }
    offset += 8 + size + (size % 2);
  }
  return 0;
}

// ------------------------------------------------------------------- visuals

const num = (value) => Number(value.toFixed(3));

/** One drawtext per line (drawtext has no centered multi-line mode in older ffmpeg versions). */
class Overlay {
  constructor(work) {
    this.work = work;
    this.filters = [];
    this.count = 0;
  }

  text(content, { start, end, size, y, color = 'white', pulse = 0, slide = false, x = '(w-text_w)/2', box = '', border = 4, blink = '' }) {
    const name = `t${this.count++}.txt`;
    writeFileSync(path.join(this.work, name), content); // UTF-8: accents need no escaping
    const enable = start === undefined ? '' : `:enable='between(t,${num(start)},${num(end)})${blink}'`;
    const fontsize = pulse ? `'${size}+${pulse}*sin(t*9)'` : size;
    const yExpr = slide ? `'${y}-max(0,1-(t-${num(start)})/0.22)*260'` : `'${y}'`;
    const style = border ? `:borderw=${border}:bordercolor=black@0.9:shadowx=3:shadowy=3:shadowcolor=black@0.6` : '';
    this.filters.push(`drawtext=${fontOption}textfile=${name}:fontsize=${fontsize}:fontcolor=${color}:x=${x}:y=${yExpr}${style}${box}${enable}`);
  }

  raw(filter) {
    this.filters.push(filter);
  }
}

/** Largest font size that keeps a line inside the 4:3 safe area. */
const fit = (line, max) => Math.max(26, Math.min(max, Math.floor(560 / (Math.max(1, line.length) * 0.72))));

function buildVisual(ad, scenes, total, work) {
  const o = new Overlay(work);
  const yTop = 70;
  const palette = ['white', '0xffe600', 'white', '0x7df9ff'];

  scenes.forEach((scene, index) => {
    const { start, end } = scene;
    // Quick white flash on every cut.
    o.raw(`drawbox=x=0:y=0:w=iw:h=ih:color=white@0.65:t=fill:enable='between(t,${num(start)},${num(start + 0.12)})'`);

    const lines = scene.linhas;
    const hasPack = Boolean(scene.pack);
    const hasSub = Boolean(scene.sub);
    const area = hasPack ? 190 : hasSub ? 250 : 330; // vertical room for the big text
    const lineHeight = Math.min(96, Math.floor(area / lines.length));
    const top = hasPack ? yTop : yTop + Math.max(0, (330 - lines.length * lineHeight) / 2) + 20;

    lines.forEach((line, i) => {
      const size = fit(line, Math.min(86, lineHeight));
      const color = i === 0 && lines.length > 1 ? palette[index % palette.length] : i === lines.length - 1 && lines.length > 2 ? '0xffe600' : 'white';
      o.text(line, { start, end, size, y: Math.round(top + i * lineHeight), color, pulse: 3, slide: true });
    });

    if (hasSub) {
      scene.sub.forEach((line, i) => {
        o.text(line, { start: start + 0.5, end, size: fit(line, 34), y: Math.round(top + lines.length * lineHeight + 8 + i * 40), color: 'white', border: 3 });
      });
    }

    if (hasPack) {
      // A wobbling product box: outer box, colored label and the product name.
      const px = 205, py = 262;
      o.raw(`drawbox=x=${px}:y='${py}+7*sin(t*6)':w=230:h=130:color=white@1:t=fill:enable='between(t,${num(start)},${num(end)})'`);
      o.raw(`drawbox=x=${px + 10}:y='${py + 10}+7*sin(t*6)':w=210:h=110:color=0xd00000@1:t=fill:enable='between(t,${num(start)},${num(end)})'`);
      o.text(scene.pack, { start, end, size: fit(scene.pack, 40), y: `${py + 42}+7*sin(t*6)`, color: '0xffe600', border: 2 });
    }

    if (scene.preco) {
      o.text(scene.preco, {
        start: start + 0.3, end, size: fit(scene.preco, 56), y: 330, color: 'black',
        box: ':box=1:boxcolor=0xffe600@1:boxborderw=14', border: 0, pulse: 3,
      });
    }

    if (scene.selo) {
      // Blinking starburst-ish label in the corner.
      o.text(scene.selo, {
        start: start + 0.2, end, size: 30, y: 44, x: 'w-text_w-26', color: 'white', border: 0,
        box: ':box=1:boxcolor=0xe60000@1:boxborderw=12', blink: '*lt(mod(t,0.6),0.42)',
      });
    }
  });

  // Fine print along the bottom, from the second scene on.
  const fineStart = scenes[1]?.start ?? 0;
  o.raw(`drawbox=x=0:y=ih-56:w=iw:h=56:color=black@0.7:t=fill:enable='gte(t,${num(fineStart)})'`);
  ad.fine.forEach((line, i) => {
    o.text(line, { start: fineStart, end: total, size: 16, y: `h-50+${i * 22}`, border: 0 });
  });

  // Top ticker.
  o.raw('drawbox=x=0:y=0:w=iw:h=36:color=black@0.75:t=fill');
  const ticker = ad.faixa.repeat(3);
  o.text(ticker, { size: 24, y: 6, x: `'w-mod(t*150,text_w+w)'`, color: '0xffe600', border: 0 });

  const gradient = `gradients=size=640x480:rate=25:duration=${num(total)}:c0=${ad.cores[0]}:c1=${ad.cores[1]}:speed=0.04:x0=0:y0=0:x1=640:y1=480`;
  // VHS/CRT feel: chroma shift, slight blur, noise, a touch of saturation, scanlines.
  const vhs = [
    'rgbashift=rh=-3:bh=3',
    'gblur=sigma=0.8',
    'noise=alls=14:allf=t',
    "geq=lum='lum(X,Y)*(0.93+0.07*sin(Y*3.1416))':cb='cb(X,Y)':cr='cr(X,Y)'",
    'eq=saturation=1.25:contrast=1.05',
    'format=yuv420p',
    `fade=t=in:d=0.2,fade=t=out:st=${num(total - 0.35)}:d=0.35`,
  ];
  return { gradient, graph: `[0:v]${o.filters.join(',')},${vhs.join(',')}[v]` };
}

// --------------------------------------------------------------------- music

/** A cheerful chiptune-ish melody plus a bouncy bass, as one aevalsrc expression. */
function musicExpression(ad, finalStart) {
  const step = 60 / ad.bpm / 2;
  const n = ad.melodia.length;
  const freq = ad.melodia.map((semitones) => (semitones === null ? 0 : num(ad.raiz * 2 ** (semitones / 12))));
  const pick = freq.map((f, k) => (f ? `eq(ld(0),${k})*${f}` : '')).filter(Boolean).join('+');
  const bass = num(ad.raiz / 2);
  return [
    `st(0,mod(floor(t/${num(step)}),${n}))`,
    `st(1,mod(t,${num(step)}))`,
    `st(2,${pick})`,
    `st(3,min(1,ld(1)*150)*exp(-ld(1)*6))`,
    `st(4,mod(t,${num(step * 2)}))`,
    `(0.16+0.16*gt(t,${num(finalStart)}))*(` +
      `(sin(2*PI*ld(2)*t)+0.35*sin(4*PI*ld(2)*t)+0.15*sin(6*PI*ld(2)*t))*ld(3)*0.55` +
      `+0.45*sin(2*PI*${bass}*t)*min(1,ld(4)*150)*exp(-ld(4)*5))`,
  ].join(';');
}

// ---------------------------------------------------------------------- main

function makeAd(ad, tts) {
  const work = mkdtempSync(path.join(tmpdir(), 'tv-gominho-ad-'));
  try {
    // 1. Narration clips and scene timing.
    const jobs = [];
    ad.cenas.forEach((scene, i) => {
      if (scene.fala) jobs.push({ out: path.join(work, `fala${i}.wav`), text: scene.fala, escala: 1, cena: i, tipo: 'fala' });
      if (scene.legal) jobs.push({ out: path.join(work, `legal${i}.wav`), text: scene.legal, escala: 0.78, cena: i, tipo: 'legal' });
    });
    const narrated = tts ? tts.speak(jobs, work) && jobs.every((job) => existsSync(job.out)) : false;
    if (tts && !narrated) console.log(`  Aviso: a narração falhou em ${ad.arquivo}; gerando sem voz.`);

    const clips = [];
    const scenes = [];
    let cursor = 0;
    ad.cenas.forEach((scene, i) => {
      const start = cursor;
      let length = SCENE_FALLBACK;
      if (narrated) {
        const fala = scene.fala ? wavSeconds(path.join(work, `fala${i}.wav`)) : 0;
        const legal = scene.legal ? wavSeconds(path.join(work, `legal${i}.wav`)) : 0;
        if (fala) clips.push({ file: `fala${i}.wav`, at: start + 0.15 });
        if (legal) clips.push({ file: `legal${i}.wav`, at: start + 0.15 + fala + 0.2 });
        length = Math.max(2.4, 0.15 + fala + (legal ? 0.2 + legal : 0) + SCENE_PAUSE);
      }
      scenes.push({ ...scene, start, end: start + length });
      cursor += length;
    });

    // Keep the ad inside 16-29 s: stretch the last scene or just warn if too long.
    if (cursor < MIN_SECONDS) {
      scenes.at(-1).end += MIN_SECONDS - cursor;
      cursor = MIN_SECONDS;
    }
    if (cursor > MAX_SECONDS) console.log(`  Aviso: ${ad.arquivo} ficou com ${cursor.toFixed(1)} s (máximo desejado: ${MAX_SECONDS} s).`);
    const total = cursor;

    // 2. Filter graph and inputs.
    const { gradient, graph } = buildVisual(ad, scenes, total, work);
    const finalStart = scenes.at(-1).start;
    const inputs = ['-f', 'lavfi', '-i', gradient];
    const audioParts = [];
    clips.forEach((clip, i) => {
      inputs.push('-i', clip.file);
      const ms = Math.round(clip.at * 1000);
      audioParts.push(`[${i + 1}:a]aresample=48000,aformat=channel_layouts=mono,adelay=${ms},volume=2.2[v${i}]`);
    });
    const musicIndex = clips.length + 1;
    inputs.push('-f', 'lavfi', '-i', `aevalsrc='${musicExpression(ad, finalStart)}':s=48000:d=${num(total)}`);
    audioParts.push(`[${musicIndex}:a]lowpass=f=5200,aformat=channel_layouts=mono[m]`);
    const mixInputs = [...clips.map((_, i) => `[v${i}]`), '[m]'].join('');
    audioParts.push(
      `${mixInputs}amix=inputs=${clips.length + 1}:normalize=0:duration=longest,alimiter=limit=0.95,` +
        `aformat=channel_layouts=stereo,afade=t=in:d=0.1,afade=t=out:st=${num(total - 0.5)}:d=0.5[a]`,
    );
    const filterGraph = `${graph};${audioParts.join(";")}`;

    // 3. Render.
    const target = path.join(out, `${ad.arquivo}.mp4`);
    const ok = run(
      [
        ...inputs,
        '-filter_complex', filterGraph,
        '-map', '[v]', '-map', '[a]',
        '-t', String(num(total)),
        '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-pix_fmt', 'yuv420p', '-profile:v', 'high', '-r', '25',
        '-c:a', 'aac', '-b:a', '128k', '-ar', '48000',
        '-movflags', '+faststart',
        target,
      ],
      work,
    );
    return ok ? { target, total } : undefined;
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

if (!check(ffmpeg, ['-version'])) {
  console.error('ffmpeg não encontrado. Instale o ffmpeg ou defina a variável FFMPEG com o caminho dele.');
  process.exit(1);
}
if (!existsSync(library)) {
  console.error(`Biblioteca não encontrada: ${library}`);
  console.error('Rode "npm run exemplo:real" (ou "npm run exemplo") antes, ou passe o caminho de uma biblioteca existente.');
  process.exit(1);
}
if (!font) console.log('Aviso: nenhuma fonte encontrada; os comerciais ficarão sem texto.');

mkdirSync(out, { recursive: true });
console.log(`Gerando comerciais fictícios em ${out}`);

const tts = await detectTts();
if (tts) {
  console.log(`Narração: ${tts.nome}`);
} else {
  console.log('Aviso: nenhum sintetizador de voz encontrado; os comerciais serão feitos só com texto e música.');
  console.log('  Para ter narração: "npm run comerciais -- --instalar-voz" (Piper, precisa de Python) ou instale o espeak-ng.');
}

let failed = 0;
for (const ad of COMERCIAIS) {
  process.stdout.write(`  ${ad.arquivo} ... `);
  const result = makeAd(ad, tts);
  if (result) {
    console.log(`${result.total.toFixed(1)} s`);
  } else {
    console.log('falhou');
    failed++;
  }
}

if (failed) {
  console.error(`${failed} comercial(is) falharam.`);
  process.exit(1);
}
console.log('Pronto! Use "- comerciais: 2" nos blocos da grade para exibi-los.');
