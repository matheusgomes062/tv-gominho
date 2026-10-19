#!/usr/bin/env node
// Builds the portable package in pacote/tv-gominho: the command-line tool (one file),
// the compiled app (with .br/.gz copies) and launchers for Windows, Linux/macOS and the
// Raspberry Pi. Copy the folder next to a "biblioteca" folder (on a USB stick, say).
//
//   npm run pacote
//
// No videos, no node_modules: the whole thing is under 2 MB.

import { spawnSync } from 'node:child_process';
import { chmodSync, cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'pacote', 'tv-gominho');
// One command string through the shell: npm is a .cmd script on Windows.

const build = spawnSync('npm run build', { cwd: root, stdio: 'inherit', shell: true });
if (build.status !== 0) process.exit(build.status ?? 1);

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
cpSync(path.join(root, 'pacotes/cli/dist/tv-gominho.mjs'), path.join(out, 'tv-gominho.mjs'));
cpSync(path.join(root, 'pacotes/interface/dist'), path.join(out, 'interface'), { recursive: true });
cpSync(path.join(root, 'scripts/raspberry-pi'), path.join(out, 'raspberry-pi'), { recursive: true });
cpSync(path.join(root, 'LICENSE'), path.join(out, 'LICENSE.txt'));

// Windows: double-click. Looks for the library next to the package folder, then inside it.
writeFileSync(
  path.join(out, 'Abrir TV Gominho.cmd'),
  [
    '@echo off',
    'setlocal',
    'cd /d "%~dp0"',
    'set "BIBLIOTECA=%~dp0..\\biblioteca"',
    'if not exist "%BIBLIOTECA%" set "BIBLIOTECA=%~dp0biblioteca"',
    'where node >nul 2>nul',
    'if errorlevel 1 (',
    '  echo O Node.js nao esta instalado. Baixe em https://nodejs.org ^(versao 22 ou mais nova^).',
    '  echo Sem o Node.js, abra interface\\index.html no Chrome ou no Edge e escolha a pasta biblioteca.',
    '  pause',
    '  exit /b 1',
    ')',
    'node "%~dp0tv-gominho.mjs" servir "%BIBLIOTECA%" --abrir',
    'pause',
    '',
  ].join('\r\n'),
);

// Linux and macOS.
const shell = path.join(out, 'abrir-tv-gominho.sh');
writeFileSync(
  shell,
  [
    '#!/bin/sh',
    '# Opens TV Gominho in the browser with the "biblioteca" folder next to this package.',
    'here="$(cd "$(dirname "$0")" && pwd)"',
    'biblioteca="$here/../biblioteca"',
    '[ -d "$biblioteca" ] || biblioteca="$here/biblioteca"',
    'command -v node >/dev/null 2>&1 || { echo "Instale o Node.js 22 ou mais novo: https://nodejs.org"; exit 1; }',
    'exec node "$here/tv-gominho.mjs" servir "$biblioteca" --abrir "$@"',
    '',
  ].join('\n'),
);
chmodSync(shell, 0o755);

writeFileSync(
  path.join(out, 'LEIA-ME.txt'),
  `TV GOMINHO
==========

Os desenhos das manhãs da sua infância, como na TV. Projeto livre (GPL-3.0), sem
afiliação com a Globo. Nenhum episódio vem junto: cada pessoa usa os próprios arquivos.

Coloque esta pasta ao lado da sua pasta "biblioteca", por exemplo no pendrive:

  E:\\tv-gominho\\      (esta pasta)
  E:\\biblioteca\\      (programas/, vinhetas/, grades/)


1. No computador, sem instalar nada
   Abra interface\\index.html no Chrome ou no Edge, clique em "Escolher biblioteca" e
   escolha a pasta biblioteca.

2. No computador, com o Node.js (https://nodejs.org, versão 22 ou mais nova)
   Windows: dois cliques em "Abrir TV Gominho.cmd".
   Linux/macOS: ./abrir-tv-gominho.sh
   A TV já abre com a biblioteca, sem escolher pasta. Para ver em outros aparelhos da
   casa (TV com navegador, celular): node tv-gominho.mjs servir ../biblioteca --rede

3. Num Raspberry Pi ligado na TV
   Veja raspberry-pi/LEIA-ME.txt: um comando deixa o Pi ligando direto no canal.

4. Numa TV com USB, sem nada além do pendrive
   No computador, gere os vídeos com a programação pronta:
     node tv-gominho.mjs grade ../biblioteca --epoca 2004
     node tv-gominho.mjs pendrive ../biblioteca --destino E:\\ --dias 5 --resolucao 480
     node tv-gominho.mjs verificar E:\\
   (o pendrive precisa do ffmpeg: https://ffmpeg.org)

Todos os comandos: node tv-gominho.mjs ajuda
`,
);

const size = (dir) => readdirSync(dir, { recursive: true }).reduce((sum, file) => {
  const info = statSync(path.join(dir, String(file)));
  return info.isFile() ? sum + info.size : sum;
}, 0);
const kb = (bytes) => `${Math.round(bytes / 1024)} KB`;
console.log(`\nPacote pronto em ${out}`);
console.log(`  total: ${kb(size(out))} (ferramenta ${kb(statSync(path.join(out, 'tv-gominho.mjs')).size)}, app ${kb(size(path.join(out, 'interface')))})`);
if (!existsSync(path.join(out, 'interface', 'index.html'))) throw new Error('interface/index.html faltando');
