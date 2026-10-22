#!/usr/bin/env node
// Downloads a small set of public-domain cartoons from the Internet Archive and
// builds a ready-to-use library in exemplo/dominio-publico/biblioteca.
//
//   npm run exemplo:real
//
// Resumable: files that already exist with the expected size are skipped.
// ffmpeg (on the PATH, or FFMPEG=/path/to/ffmpeg) is optional: it is only used
// to make posters, backdrops and simple bumpers. Without it those are skipped.
//
// Only ORIGINAL English versions are used (dubs are separate works with their
// own rights). See CREDITOS.txt, written into the library, for the sources.

import { spawnSync } from 'node:child_process';
import { createWriteStream, existsSync, mkdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'exemplo', 'dominio-publico', 'biblioteca');
const marker = path.join(out, '.gerado-pelo-tv-gominho');
const ffmpeg = process.env.FFMPEG ?? 'ffmpeg';

/**
 * Catalog. `id` is the archive.org identifier, `arquivo` the file inside the item
 * and `tamanho` its size in bytes (from https://archive.org/metadata/<id>).
 * `pd` explains why each item is in the public domain.
 */
const PROGRAMAS = [
  {
    pasta: 'superman-fleischer',
    titulo: 'Superman (Fleischer)',
    titulo_original: 'Superman (Fleischer Studios)',
    ano: 1941,
    descricao: 'Os clássicos desenhos do Superman dos estúdios Fleischer: robôs gigantes, cientistas malucos e muita ação em technicolor.',
    classificacao: 'Livre',
    capaSegundos: 25,
    fonte: {
      id: 'superman-the-complete-collection-fleischerfamous-studios',
      pd: 'Desenhos de 1941-1943 da Paramount/Fleischer cujo registro de direitos autorais não foi renovado e caiu em domínio público nos EUA; o item está marcado como Public Domain Mark 1.0 no Internet Archive. (O personagem em si continua sendo marca da DC; use apenas como exemplo local.)',
    },
    episodios: [
      {
        titulo: 'O Cientista Maluco',
        descricao: 'Um cientista louco ameaça a cidade com um raio mortal e só o Superman pode impedi-lo.',
        arquivo: 'Superman E01 - The Mad Scientist (1941).mp4',
        tamanho: 59795507,
      },
      {
        titulo: 'Os Monstros Mecânicos',
        descricao: 'Robôs gigantes assaltam a cidade, e Lois Lane corre perigo.',
        arquivo: 'Superman E02 - The Mechanical Monsters (1941).mp4',
        tamanho: 58294982,
      },
      {
        titulo: 'O Gigante do Ártico',
        descricao: 'Um dinossauro congelado acorda no gelo e chega à cidade grande.',
        arquivo: 'Superman E04 - The Arctic Giant (1942).mp4',
        tamanho: 49370588,
      },
      {
        titulo: 'O Terremoto Elétrico',
        descricao: 'Um inventor usa uma máquina de terremotos para chantagear a cidade.',
        arquivo: 'Superman E07 - Electric Earthquake (1942).mp4',
        tamanho: 49745905,
      },
    ],
  },
  {
    pasta: 'popeye-contos-das-mil-e-uma-noites',
    titulo: 'Popeye e as Mil e Uma Noites',
    titulo_original: 'Popeye the Sailor (Color Specials)',
    ano: 1936,
    descricao: 'O marinheiro Popeye enfrenta piratas, gênios e vilões nas aventuras especiais coloridas dos estúdios Fleischer.',
    classificacao: 'Livre',
    capaSegundos: 60,
    fonte: {
      id: 'vários (veja cada episódio)',
      pd: 'Curtas de Popeye de 1936-1939 (Fleischer/Paramount) cujo registro de direitos autorais não foi renovado nos EUA, hoje em domínio público.',
    },
    episodios: [
      {
        titulo: 'Popeye Encontra Simbad, o Marujo',
        descricao: 'Popeye enfrenta o gigante Simbad e a gigantesca ave Roc.',
        id: 'popeye-the-sailor-meets-sindbad-the-sailor-1936',
        arquivo: 'Popeye the Sailor Meets Sindbad the Sailor (1936).mp4',
        tamanho: 92350645,
      },
      {
        titulo: 'O Pequeno Zezinho',
        descricao: 'Popeye cuida do bebê Zezinho, que se mete em confusão a cada passo.',
        id: 'little_sweepea',
        arquivo: 'little_sweepea_512kb.mp4',
        tamanho: 31067139,
      },
      {
        titulo: 'Popeye Encontra Ali Babá e os 40 Ladrões',
        descricao: 'Popeye enfrenta os quarenta ladrões e o terrível Abu Hassan.',
        id: 'PopeyeAliBabaRestored512kb',
        arquivo: 'PopeyeAliBabaRestored_512kb.mp4',
        tamanho: 77624035,
      },
      {
        titulo: 'Popeye e a Lâmpada Maravilhosa',
        descricao: 'Popeye encontra a lâmpada de Aladim e é perseguido por um mago malvado.',
        id: 'Popeye_the_Sailor_Meets_Aladdin_and_His_Wonderful_Lamp',
        arquivo: 'Popeye_-_Aladdin_and_His_Wonderful_Lamp_512kb.mp4',
        tamanho: 95101013,
      },
    ],
  },
  {
    pasta: 'gato-felix',
    titulo: 'O Gato Félix',
    titulo_original: 'Felix the Cat',
    ano: 1919,
    descricao: 'Os primeiros desenhos mudos do Gato Félix, o gato mais esperto do cinema, cheios de gags e truques.',
    classificacao: 'Livre',
    capaSegundos: 8,
    fonte: {
      id: 'vários (veja cada episódio)',
      pd: 'Curtas mudos de 1919-1923, publicados nos EUA antes de 1929, portanto em domínio público por decurso de prazo.',
    },
    episodios: [
      {
        titulo: 'Loucuras de Gato',
        descricao: 'Félix tenta se livrar de uma gataria barulhenta que aparece no quintal.',
        id: 'FelixTheCat-FelineFollies1919',
        arquivo: 'FelixTheCat-1919-FelineFollies_512kb.mp4',
        tamanho: 18536894,
      },
      {
        titulo: 'A Idade da Pedra',
        descricao: 'Félix viaja para a era dos dinossauros.',
        id: 'FelixTheCat-TheStoneAge1922',
        arquivo: 'FelixTheCat-1922-TheStoneAge_512kb.mp4',
        tamanho: 12019663,
      },
      {
        titulo: 'A Revolta de Félix',
        descricao: 'Félix se rebela e resolve fazer greve de gato.',
        id: 'FelixTheCat-FelixRevolts1923',
        arquivo: 'FelixTheCat-1923-FelixRevolts_512kb.mp4',
        tamanho: 35936807,
      },
      {
        titulo: 'Félix no País das Fadas',
        descricao: 'Félix chega a um mundo mágico cheio de surpresas.',
        id: 'FelixTheCat-FelixInFairyland1923',
        arquivo: 'FelixTheCat-1923-FelixInFairyland_512kb.mp4',
        tamanho: 39902611,
      },
    ],
  },
  // Colour shorts, each checked against Wikipedia's "List of animated films in the public
  // domain in the United States" (copyright not renewed). All are from 1955 or earlier, so
  // also public domain in Brazil (Lei 9.610/98, art. 44). Left out on purpose despite being
  // free: Fresh Hare (minstrel ending), Wackiki Wabbit (racial caricature), Daffy - The
  // Commando (war propaganda).
  {
    pasta: 'pica-pau',
    titulo: 'Pica-Pau',
    titulo_original: 'Woody Woodpecker',
    ano: 1941,
    descricao: 'O pica-pau mais maluco do cinema, no seu terceiro desenho, o único dele em domínio público.',
    classificacao: 'Livre',
    capaSegundos: 40,
    fonte: {
      id: 'woody_woodpecker_pantry_panic',
      pd: 'Curta de 1941 de Walter Lantz/Universal cujo registro de direitos autorais não foi renovado; é o único desenho do Pica-Pau em domínio público nos EUA. O personagem continua sendo marca da Universal.',
    },
    episodios: [
      {
        titulo: 'Pânico na Despensa',
        descricao: 'O inverno chega, a comida acaba, e o Pica-Pau começa a ver o gato faminto como jantar (e vice-versa).',
        arquivo: 'woody_woodpecker_pantry_panic_512kb.mp4',
        tamanho: 29904006,
      },
    ],
  },
  {
    pasta: 'gasparzinho',
    titulo: 'Gasparzinho',
    titulo_original: 'Casper the Friendly Ghost',
    ano: 1945,
    descricao: 'O fantasminha camarada que só queria fazer amigos, nos primeiros desenhos dos estúdios Famous.',
    classificacao: 'Livre',
    capaSegundos: 30,
    fonte: {
      id: 'vários (veja cada episódio)',
      pd: 'Noveltoons de 1945 e 1948 (Famous Studios/Paramount) cujo registro de direitos autorais não foi renovado nos EUA. O personagem continua sendo marca de seus donos.',
    },
    episodios: [
      {
        titulo: 'O Fantasminha Camarada',
        descricao: 'O primeiro desenho do Gasparzinho: todo mundo foge dele, até ele encontrar dois amigos.',
        id: 'TheFriendlyGhost',
        arquivo: 'TheFriendlyGhost_512kb.mp4',
        tamanho: 40828377,
      },
      {
        titulo: 'Boas Assombrações Esta Noite',
        descricao: 'Gasparzinho fica amigo de uma raposinha e precisa salvá-la dos caçadores.',
        id: 'noveltoon_casper_tfg_theres_good_boos_tonight',
        arquivo: 'noveltoon_casper_tfg_theres_good_boos_tonight_512kb.mp4',
        tamanho: 38148356,
      },
    ],
  },
  {
    pasta: 'luluzinha',
    titulo: 'Luluzinha',
    titulo_original: 'Little Lulu',
    ano: 1946,
    descricao: 'A Luluzinha das tirinhas em desenhos coloridos dos estúdios Famous, com o Bolinha sempre por perto.',
    classificacao: 'Livre',
    capaSegundos: 30,
    fonte: {
      id: 'vários (veja cada episódio)',
      pd: 'Curtas de 1946 e 1947 (Famous Studios/Paramount) cujo registro de direitos autorais não foi renovado nos EUA. A personagem continua sendo marca de seus donos.',
    },
    episodios: [
      {
        titulo: 'Sono na Aula',
        descricao: 'Luluzinha cochila na aula de história e vai parar na viagem de Colombo.',
        id: 'LLBoredOfEducation',
        arquivo: 'LLBoredOfEducation_512kb.mp4',
        tamanho: 28543816,
      },
      {
        titulo: 'Uma Briga com uma Truta',
        descricao: 'Luluzinha mata aula para pescar e acaba no fundo do rio com um peixe nada amigável.',
        id: 'a-bout-with-a-trout-1947',
        arquivo: 'A Bout with a Trout (1947).mp4',
        tamanho: 36162013,
      },
    ],
  },
  {
    pasta: 'pernalonga',
    titulo: 'Pernalonga',
    titulo_original: 'Bugs Bunny (Merrie Melodies)',
    ano: 1943,
    descricao: 'O coelho mais folgado do desenho animado, em dois curtas clássicos dos anos 40.',
    classificacao: 'Livre',
    capaSegundos: 45,
    fonte: {
      id: 'vários (veja cada episódio)',
      pd: 'Merrie Melodies de 1943 (Warner Bros.) cujo registro de direitos autorais não foi renovado nos EUA. Os personagens continuam sendo marcas da Warner Bros.',
    },
    episodios: [
      {
        titulo: 'Coelho em Queda Livre',
        descricao: 'Pernalonga duvida que existam gremlins sabotando aviões, até encontrar um.',
        id: 'falling-hare-1943',
        arquivo: 'Falling Hare (1943).mp4',
        tamanho: 32730419,
      },
      {
        titulo: 'Um Concerto Maluco',
        descricao: 'Valsas de Strauss com Hortelino, Gaguinho, Pernalonga e Patolino desafinando tudo.',
        id: 'ACornyConcerto1943BugsBunny',
        arquivo: 'ACornyConcerto1943BugsBunnyDaffyDuckElmerFudd-m735o_eewgg.mp4',
        tamanho: 35989899,
      },
    ],
  },
];

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

const hasFfmpeg = spawnSync(ffmpeg, ['-version'], { stdio: 'ignore' }).status === 0;

/** Runs ffmpeg; returns false instead of exiting, since everything it makes is optional. */
function run(args) {
  const result = spawnSync(ffmpeg, ['-v', 'error', '-y', ...args], { stdio: ['ignore', 'inherit', 'inherit'] });
  return result.status === 0;
}

function file(relative, content) {
  const target = path.join(out, relative);
  mkdirSync(path.dirname(target), { recursive: true });
  if (content !== undefined) writeFileSync(target, content);
  return target;
}

const megabytes = (bytes) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

/** Streams a URL to `<target>.part` and renames it when the size matches. */
async function download(url, target, expectedSize) {
  if (existsSync(target) && statSync(target).size === expectedSize) return false;
  mkdirSync(path.dirname(target), { recursive: true });
  const temp = `${target}.part`;
  const response = await fetch(url, { redirect: 'follow' });
  if (!response.ok || !response.body) throw new Error(`HTTP ${response.status} em ${url}`);

  const total = Number(response.headers.get('content-length')) || expectedSize;
  let received = 0;
  let lastPrint = 0;
  const body = Readable.fromWeb(response.body);
  body.on('data', (chunk) => {
    received += chunk.length;
    const now = Date.now();
    if (now - lastPrint > 500) {
      lastPrint = now;
      process.stdout.write(`\r    ${megabytes(received)} / ${megabytes(total)} (${Math.floor((received / total) * 100)}%)   `);
    }
  });
  try {
    await pipeline(body, createWriteStream(temp));
  } catch (error) {
    rmSync(temp, { force: true });
    throw error;
  }
  process.stdout.write('\r' + ' '.repeat(60) + '\r');
  const size = statSync(temp).size;
  if (size !== expectedSize) {
    rmSync(temp, { force: true });
    throw new Error(`Tamanho inesperado em ${url}: ${size} bytes (esperado ${expectedSize}).`);
  }
  renameSync(temp, target);
  return true;
}

/** A poster (2:3) or backdrop (16:9) from a frame of an episode, with a blurred fill. */
function artwork(video, target, { width, height, seconds, blurred }) {
  if (!hasFfmpeg || existsSync(target)) return;
  const fill = `scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height}`;
  const filter = blurred
    ? `[0:v]split[a][b];[a]${fill},boxblur=20[bg];[b]scale=${width}:-2[fg];[bg][fg]overlay=(W-w)/2:(H-h)/2`
    : fill;
  const ok = run(['-ss', String(seconds), '-i', video, '-frames:v', '1', '-filter_complex', filter, target]);
  if (!ok) console.log(`    Aviso: não foi possível gerar ${path.basename(target)}.`);
}

/** Simple generated bumper (color card + text + tone); nothing copyrighted. */
function bumper(relative, { title, seconds, color, tone }) {
  const target = path.join(out, relative);
  if (!hasFfmpeg || existsSync(target)) return;
  mkdirSync(path.dirname(target), { recursive: true });
  const safe = title.replace(/[:'\\]/g, ' ');
  const draw = font
    ? `,drawtext=${fontOption}text='${safe}':fontsize=54:fontcolor=white:x=(w-text_w)/2:y=(h-text_h)/2:box=1:boxcolor=black@0.45:boxborderw=18`
    : '';
  const ok = run([
    '-f', 'lavfi', '-i', `color=c=${color}:size=640x480:rate=25:duration=${seconds}`,
    '-f', 'lavfi', '-i', `sine=frequency=${tone}:sample_rate=48000:duration=${seconds}`,
    '-vf', `format=yuv420p${draw}`,
    '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', '-profile:v', 'high',
    '-c:a', 'aac', '-b:a', '96k', '-movflags', '+faststart', '-shortest',
    target,
  ]);
  if (!ok) console.log(`    Aviso: não foi possível gerar ${relative}.`);
}

const pad = (n) => String(n).padStart(3, '0');
const quote = (text) => JSON.stringify(text); // JSON strings are valid YAML

// Never touch a folder this script didn't create; an existing one with the marker is reused.
// Libraries made before the project was renamed carry the old marker.
const oldMarker = path.join(out, '.gerado-pelo-tv-chuvisco');
if (existsSync(oldMarker) && !existsSync(marker)) renameSync(oldMarker, marker);
if (existsSync(out) && !existsSync(marker)) {
  console.error(`${out} já existe e não foi criada por este script. Apague ou renomeie a pasta antes.`);
  process.exit(1);
}
file('.gerado-pelo-tv-gominho', 'Biblioteca de domínio público baixada por scripts/baixar-exemplo.mjs. Pode apagar.\n');

const totalBytes = PROGRAMAS.flatMap((p) => p.episodios).reduce((sum, e) => sum + e.tamanho, 0);
console.log(`Biblioteca de domínio público em ${out}`);
console.log(`Download total: cerca de ${megabytes(totalBytes)} (arquivos já baixados são pulados).`);
if (!hasFfmpeg) console.log('Aviso: ffmpeg não encontrado; capas, fundos e vinhetas serão ignorados.');

const credits = [
  'CRÉDITOS E FONTES',
  '=================',
  '',
  'Todos os vídeos desta biblioteca foram baixados do Internet Archive (https://archive.org)',
  'e são versões ORIGINAIS em inglês de desenhos em domínio público. Versões dubladas não',
  'são usadas, porque dublagens são obras separadas, com direitos próprios.',
  'Confira sempre a situação legal na sua jurisdição antes de redistribuir.',
  '',
];

let index = 0;
const count = PROGRAMAS.reduce((sum, p) => sum + p.episodios.length, 0);
try {
  for (const programa of PROGRAMAS) {
    const base = `programas/${programa.pasta}`;
    console.log(`\n${programa.titulo}`);

    file(`${base}/programa.yaml`, [
      `titulo: ${quote(programa.titulo)}`,
      `titulo_original: ${quote(programa.titulo_original)}`,
      `ano: ${programa.ano}`,
      `descricao: ${quote(programa.descricao)}`,
      `classificacao: ${programa.classificacao}`,
      '',
    ].join('\n'));
    file(`${base}/episodios.yaml`, programa.episodios
      .map((ep, i) => `"${pad(i + 1)}":\n  titulo: ${quote(ep.titulo)}\n  descricao: ${quote(ep.descricao)}\n`)
      .join(''));

    credits.push(`${programa.titulo} (${programa.titulo_original}, ${programa.ano})`);
    credits.push(`  Base de domínio público: ${programa.fonte.pd}`);

    let primeiro;
    for (const [i, ep] of programa.episodios.entries()) {
      index++;
      const id = ep.id ?? programa.fonte.id;
      const url = `https://archive.org/download/${id}/${encodeURIComponent(ep.arquivo)}`;
      const target = path.join(out, base, 'episodios', `${pad(i + 1)} - ${ep.titulo}.mp4`);
      primeiro ??= target;
      console.log(`  [${index}/${count}] ${pad(i + 1)} - ${ep.titulo} (${megabytes(ep.tamanho)})`);
      const baixou = await download(url, target, ep.tamanho);
      if (!baixou) console.log('    já existe, pulando.');
      credits.push(`  ${pad(i + 1)} - ${ep.titulo}: https://archive.org/details/${id}`);
    }
    credits.push('');

    artwork(primeiro, path.join(out, base, 'capa.png'), { width: 400, height: 600, seconds: programa.capaSegundos, blurred: true });
    artwork(primeiro, path.join(out, base, 'fundo.png'), { width: 1280, height: 720, seconds: programa.capaSegundos, blurred: false });
  }
} catch (error) {
  console.error(`\nFalha no download: ${error.message}`);
  console.error('Rode o comando de novo para continuar de onde parou.');
  process.exit(1);
}

// Generated bumpers (optional).
bumper('vinhetas/aberturas/abertura.mp4', { title: 'Sessão Desenho', seconds: 4, color: '0x2a4fd6', tone: 880 });
bumper('vinhetas/encerramentos/encerramento.mp4', { title: 'Até a próxima!', seconds: 4, color: '0xd6482a', tone: 784 });
credits.push('Vinhetas (abertura, encerramento): geradas por scripts/baixar-exemplo.mjs com o ffmpeg;');
credits.push('são cartões de cor simples, sem material de terceiros.');
credits.push('');

file('grades/sessao-desenho.yaml', `nome: Sessão Desenho
descricao: Bloco matinal de desenhos clássicos em domínio público. Gerada por scripts/baixar-exemplo.mjs.
data_inicio: 2026-01-05
dias: [seg, ter, qua, qui, sex]

blocos:
  - horario: "08:00"
    itens:
      - vinheta: aberturas
      - programa: superman-fleischer
      - comerciais: 2
      - programa: popeye-contos-das-mil-e-uma-noites
      - comerciais: 2
      - programa: gato-felix
      - vinheta: encerramentos

  - horario: "09:00"
    itens:
      - vinheta: aberturas
      - programa: gato-felix
      - comerciais: 2
      - programa: popeye-contos-das-mil-e-uma-noites
      - comerciais: 2
      - programa: superman-fleischer
      - vinheta: encerramentos
`);

file('CREDITOS.txt', credits.join('\n') + '\n');

console.log('\nPronto! Rode "npm run dev" e escolha a pasta:');
console.log(`  ${out}`);
console.log('\nQuer comerciais fictícios (opcional, com narração se houver voz instalada)?');
console.log('  npm run comerciais');
