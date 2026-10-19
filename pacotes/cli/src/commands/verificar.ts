import { execFile } from 'node:child_process';
import { readdir, stat, statfs } from 'node:fs/promises';
import path from 'node:path';
import { CliError, UsageError } from '../errors';
import { locateFfmpeg, probe } from '../ffmpeg';
import { ffmpegOptions, helpOptions, parseOptions } from '../options';
import { checkFileSystem, checkName, checkVideo, moovBeforeMdat, type Finding } from '../pendrive/compat';
import { PLAY_FOLDER } from '../pendrive/names';
import { formatBytes, plural } from '../ui';
import type { Command } from './types';

const OPTIONS = { ...helpOptions, ...ffmpegOptions } as const;

const VIDEO = /\.(?:mp4|m4v|mov|mkv|avi|wmv|ts|webm|mpg|mpeg|flv|rmvb)$/i;

const HELP = `Uso:
  tv-gominho verificar <pasta ou arquivo>

Confere se uma TV deve conseguir tocar os vídeos pelo USB, sem precisar da TV: lê cada
vídeo com o ffprobe e compara com o que os aparelhos aceitam (H.264 até o nível 4.1,
cores yuv420p, som AAC estéreo, MP4 com o índice no começo, arquivos de menos de 4 GB) e
com as regras do pendrive (nomes que o FAT32 aceita, sistema de arquivos FAT32 ou exFAT).

Aponte para o pendrive (ou para a pasta que o "tv-gominho pendrive" gerou): se houver a
pasta "${PLAY_FOLDER}", só ela é conferida. Também serve para qualquer vídeo solto.

Termina com código 1 se algum vídeo tem um erro (a TV provavelmente não toca), e 0 se
houver só avisos (pode não tocar em TVs mais antigas) ou nada.

Opções:
  --ffmpeg <caminho>   ffmpeg a usar (o ffprobe é procurado ao lado)
  --ajuda              mostra esta ajuda

Exemplo:
  tv-gominho verificar E:\\`;

export const verificarCommand: Command = {
  name: 'verificar',
  summary: 'Confere se uma TV deve tocar os vídeos de um pendrive (simula a TV)',
  help: HELP,
  async run(argv, { signal }) {
    const { values, positionals } = parseOptions(argv, OPTIONS);
    if (values.ajuda) {
      console.log(HELP);
      return 0;
    }
    if (positionals.length !== 1) throw new UsageError('Informe o pendrive, uma pasta ou um vídeo: tv-gominho verificar E:\\');
    const target = path.resolve(positionals[0]!);
    const info = await stat(target).catch(() => null);
    if (!info) throw new CliError(`"${positionals[0]}" não existe.`);

    let files: string[];
    let base: string;
    if (info.isDirectory()) {
      const play = path.join(target, PLAY_FOLDER);
      base = (await stat(play).catch(() => null))?.isDirectory() ? play : target;
      files = (await readdir(base, { recursive: true, withFileTypes: true }))
        .filter((entry) => entry.isFile() && VIDEO.test(entry.name) && !path.relative(base, entry.parentPath).split(path.sep).some((part) => part.startsWith('.')))
        .map((entry) => path.join(entry.parentPath, entry.name))
        .sort((a, b) => a.localeCompare(b, 'pt-BR', { numeric: true }));
    } else {
      base = path.dirname(target);
      files = [target];
    }
    if (files.length === 0) throw new CliError(`Nenhum vídeo em "${base}".`);

    const tools = await locateFfmpeg({ ffmpeg: values.ffmpeg });
    const fileSystem = await fileSystemOf(target);
    console.log(`Conferindo ${plural(files.length, 'vídeo')} em ${base}`);
    console.log(`Sistema de arquivos: ${fileSystem ?? 'não deu para saber'}`);
    const fsFindings = checkFileSystem(fileSystem);
    for (const finding of fsFindings) console.log(`  ${mark(finding)} ${finding.message}`);
    console.log('');

    let errors = 0;
    let warnings = fsFindings.length;
    for (const file of files) {
      if (signal.aborted) return 130;
      const { size } = await stat(file);
      const findings: Finding[] = [...checkName(path.basename(file))];
      try {
        const media = await probe(tools, file);
        findings.push(...checkVideo({ bytes: size, info: media, moovFirst: await moovBeforeMdat(file).catch(() => null), fileSystem }));
      } catch (error) {
        findings.push({ severity: 'erro', message: `não consegui ler o vídeo: ${(error as Error).message}` });
      }
      const fileErrors = findings.filter((finding) => finding.severity === 'erro').length;
      errors += fileErrors;
      warnings += findings.length - fileErrors;
      const status = fileErrors > 0 ? 'não toca' : findings.length > 0 ? 'talvez' : 'ok';
      console.log(`${status.padEnd(9)} ${path.relative(base, file)} (${formatBytes(size)})`);
      for (const finding of findings) console.log(`          ${mark(finding)} ${finding.message}`);
    }

    console.log('');
    if (errors > 0) console.log(`Resultado: ${plural(errors, 'erro')}: esses vídeos provavelmente não tocam na TV. Gere de novo com "tv-gominho pendrive" ou converta com "tv-gominho converter".`);
    else if (warnings > 0) console.log(`Resultado: deve tocar na maioria das TVs (${plural(warnings, 'aviso')}: veja acima o que pode falhar em TVs mais antigas).`);
    else console.log('Resultado: tudo certo. Deve tocar em qualquer TV com USB que toque MP4.');
    return errors > 0 ? 1 : 0;
  },
};

const mark = (finding: Finding) => (finding.severity === 'erro' ? '[erro]' : '[aviso]');

// Linux statfs magic numbers of the file systems a USB stick can have.
const LINUX_TYPES: Record<number, string> = { 0x4d44: 'FAT32', 0x2011bab0: 'exFAT', 0x5346544e: 'NTFS', 0x65735546: 'fuseblk (provavelmente NTFS ou exFAT)' };

/** The file system that holds `target` ("FAT32", "exFAT", "NTFS"...), or null when the system doesn't tell. */
async function fileSystemOf(target: string): Promise<string | null> {
  if (process.platform === 'win32') {
    const drive = /^([a-z]):/i.exec(target)?.[1];
    if (!drive) return null;
    // An absolute path, run from the system folder: a bare "powershell.exe" would also be looked
    // up in the current folder, where a stick or a download could plant one.
    const system = process.env.SystemRoot ?? 'C:\\Windows';
    const powershell = path.join(system, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    return new Promise((resolve) => {
      execFile(
        powershell,
        ['-NoProfile', '-NonInteractive', '-Command', `(Get-Volume -DriveLetter ${drive.toUpperCase()}).FileSystem`],
        { timeout: 15_000, windowsHide: true, cwd: system },
        (error, stdout) => resolve(error ? null : stdout.trim() || null),
      );
    });
  }
  if (process.platform === 'linux') {
    const info = await statfs(target).catch(() => null);
    return info ? (LINUX_TYPES[Number(info.type)] ?? `tipo 0x${Number(info.type).toString(16)}`) : null;
  }
  return null;
}
