import { constants, existsSync } from 'node:fs';
import { copyFile, mkdir, rename, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { isConvertibleVideo, isPlayableVideo } from '@tv-gominho/nucleo';
import { CliError, UsageError } from '../errors';
import { createJevClient, jevApiKey } from '../jev/client';
import { openNodeLibrary, resolveForWrite } from '../node-source';
import { helpOptions, parseOptions } from '../options';
import { classifyFiles } from '../organizar/classify';
import { planOrganize, type Plan, type PlanEntry } from '../organizar/plan';
import { plural } from '../ui';
import type { Command, CommandContext } from './types';

const OPTIONS = {
  ...helpOptions,
  simular: { type: 'boolean' },
  copiar: { type: 'boolean' },
} as const;

const HELP = `Uso:
  tv-gominho organizar <pasta de downloads> <biblioteca> [opções]

Arruma vídeos baixados na biblioteca (veja docs/biblioteca.md): cada episódio vai para
programas/<programa>/episodios/ e cada vinheta, comercial ou chamada para vinhetas/.

Quem reconhece os arquivos é o Jev, um modelo de IA da TypeSafe (https://typesafe.ai),
a partir do nome do arquivo e da pasta. Os vídeos não saem do computador: só os nomes
são enviados. Precisa de internet e de uma chave em TYPESAFE_API_KEY (arquivo .env).

O Jev só escolhe entre opções conhecidas: os programas da lista da TV Globinho
(docs/programas-tv-globinho.md) ou "outro", o tipo de vídeo e a emissora da vinheta.
Quando ele não tem certeza, o arquivo fica onde está e aparece em "Para revisar".
Filmes e extras (amostras, making of, músicas de abertura) também ficam onde estão.

Nada é apagado nem sobrescrito: um arquivo que já existe na biblioteca é pulado. As
respostas do Jev ficam guardadas em <pasta de downloads>/.tv-gominho/, então rodar
de novo (por exemplo, depois do --simular) não pergunta tudo outra vez.

Opções:
  --simular     só mostra o que seria feito, sem mexer em nada
  --copiar      copia os arquivos em vez de mover
  --ajuda       mostra esta ajuda

Exemplos:
  tv-gominho organizar ~/Downloads/desenhos ./biblioteca --simular
  tv-gominho organizar D:\\Baixados E:\\biblioteca --copiar`;

export const organizarCommand: Command = {
  name: 'organizar',
  summary: 'Arruma vídeos baixados na biblioteca, com a ajuda do Jev (IA)',
  help: HELP,
  async run(argv, context) {
    const { values, positionals } = parseOptions(argv, OPTIONS);
    if (values.ajuda) {
      console.log(HELP);
      return 0;
    }
    if (positionals.length !== 2) {
      throw new UsageError('Informe a pasta de downloads e a biblioteca: tv-gominho organizar <downloads> <biblioteca>. Veja "tv-gominho organizar --ajuda".');
    }
    return organize(positionals[0]!, positionals[1]!, { simulate: Boolean(values.simular), copy: Boolean(values.copiar) }, context);
  },
};

const inside = (parent: string, child: string) => {
  const relative = path.relative(parent, child);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
};

async function organize(from: string, to: string, options: { simulate: boolean; copy: boolean }, { signal }: CommandContext): Promise<number> {
  const downloads = await openNodeLibrary(from);
  const library = path.resolve(to);
  if (inside(downloads.dir, library)) throw new UsageError('A biblioteca não pode ficar dentro da pasta de downloads (nem ser a mesma pasta).');
  if (existsSync(library) && !(await stat(library)).isDirectory()) throw new CliError(`"${to}" não é uma pasta.`);
  const apiKey = jevApiKey();

  const videos = downloads.files.filter((file) => isPlayableVideo(file) || isConvertibleVideo(file));
  if (videos.length === 0) {
    console.log(`Nenhum vídeo em ${downloads.dir}.`);
    return 0;
  }

  const jev = await createJevClient({ apiKey, cacheFile: path.join(downloads.dir, '.tv-gominho', 'jev.json'), signal });
  console.log(`Perguntando ao Jev sobre ${plural(videos.length, 'vídeo')}...`);
  let classified;
  try {
    classified = await classifyFiles(videos, jev, (done, total) => {
      if (process.stdout.isTTY) process.stdout.write(`\r  ${done}/${total}`);
    });
  } finally {
    await jev.save();
    if (process.stdout.isTTY) process.stdout.write('\r');
  }
  console.log(
    jev.requests > 0
      ? `Jev: ${plural(jev.requests, 'pergunta', 'perguntas')} (${jev.tokens.toLocaleString('pt-BR')} tokens).`
      : 'Jev: todas as respostas já estavam guardadas.',
  );

  const plan = planOrganize(classified, (libraryPath) => existsSync(path.join(library, ...libraryPath.split('/'))));
  report(plan);

  const moves = plan.entries.filter((entry): entry is Extract<PlanEntry, { status: 'mover' }> => entry.status === 'mover');
  if (options.simulate) {
    console.log(`\nSimulação: nada foi ${options.copy ? 'copiado' : 'movido'}. Rode sem --simular para fazer.`);
    return 0;
  }
  if (moves.length === 0) return 0;

  await mkdir(library, { recursive: true });
  const done: { from: string; to: string }[] = [];
  try {
    for (const move of moves) {
      if (signal.aborted) break;
      const source = downloads.resolve(move.from);
      const target = await resolveForWrite(library, move.to);
      if (existsSync(target)) continue; // appeared meanwhile: never overwrite
      await mkdir(path.dirname(target), { recursive: true });
      await transfer(source, target, options.copy);
      done.push({ from: source, to: target });
    }
    for (const show of plan.newShows) {
      const file = await resolveForWrite(library, `programas/${show.slug}/programa.yaml`);
      if (existsSync(file) || !existsSync(path.dirname(file))) continue;
      const lines = [`titulo: ${JSON.stringify(show.title)}`, ...(show.originalTitle ? [`titulo_original: ${JSON.stringify(show.originalTitle)}`] : [])];
      await writeFile(file, `${lines.join('\n')}\n`);
    }
  } finally {
    // What went where, to undo by hand if needed. Hidden folder: the app ignores it.
    if (done.length > 0) {
      const log = path.join(library, '.tv-gominho', `organizar-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
      await mkdir(path.dirname(log), { recursive: true });
      await writeFile(log, JSON.stringify({ copiado: options.copy, arquivos: done }, null, 2));
    }
  }

  console.log(`\n${plural(done.length, 'arquivo')} ${options.copy ? (done.length === 1 ? 'copiado' : 'copiados') : done.length === 1 ? 'movido' : 'movidos'} para ${library}.`);
  if (done.some((file) => isConvertibleVideo(file.to))) {
    console.log(`Alguns vídeos estão em formatos que o app não toca (AVI, MKV...). Converta com: tv-gominho converter "${to}"`);
  }
  if (plan.newShows.length > 0) console.log(`Para montar o canal com os programas: tv-gominho grade "${to}"`);
  return 0;
}

/** Moves (or copies) a file without ever replacing one; across disks a move is a checked copy. */
async function transfer(source: string, target: string, copy: boolean): Promise<void> {
  if (!copy) {
    try {
      await rename(source, target);
      return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EXDEV') throw error;
    }
  }
  await copyFile(source, target, constants.COPYFILE_EXCL);
  if ((await stat(source)).size !== (await stat(target)).size) {
    await unlink(target);
    throw new CliError(`A cópia de ${source} saiu incompleta; o original ficou onde estava.`);
  }
  if (!copy) await unlink(source);
}

function report(plan: Plan) {
  const by = <S extends PlanEntry['status']>(status: S) => plan.entries.filter((entry): entry is Extract<PlanEntry, { status: S }> => entry.status === status);
  const moves = by('mover');
  if (moves.length > 0) {
    const destinations = new Map<string, number>();
    for (const move of moves) {
      // A show's folder as a whole (seasons included); for vinhetas, the folder the file lands in.
      const folder = move.role === 'episodio' ? move.to.split('/').slice(0, 2).join('/') : move.to.slice(0, move.to.lastIndexOf('/'));
      destinations.set(folder, (destinations.get(folder) ?? 0) + 1);
    }
    console.log(`\nVão para a biblioteca (${moves.length}):`);
    for (const [folder, count] of [...destinations].sort()) console.log(`  ${folder}/  ${plural(count, 'arquivo')}`);
  }
  const reviews = by('revisar');
  if (reviews.length > 0) {
    console.log(`\nPara revisar (${reviews.length}), ficam onde estão:`);
    for (const entry of reviews) console.log(`  ${entry.from}\n    ${entry.reason}`);
  }
  const kept = by('deixar');
  if (kept.length > 0) {
    console.log(`\nFilmes e extras (${kept.length}), ficam onde estão:`);
    for (const entry of kept) console.log(`  ${entry.from}  (${entry.role})`);
  }
  const existing = by('existe');
  if (existing.length > 0) {
    console.log(`\nJá existem na biblioteca (${existing.length}), pulados:`);
    for (const entry of existing) console.log(`  ${entry.from}  ->  ${entry.to}`);
  }
}
