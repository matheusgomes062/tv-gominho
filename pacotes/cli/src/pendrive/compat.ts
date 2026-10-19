// What the USB player of a TV is likely to refuse (docs/pendrive.md, "Simular a TV"). There is no
// way to run a TV here, so these are the limits TV makers publish (LG lists H.264 up to level 4.2
// and 20 Mb/s at 1080p) narrowed to what TVs from about 2010 on take, plus the FAT32 rules.
// Pure: tested without ffmpeg or a pendrive.

import { open } from 'node:fs/promises';
import type { MediaInfo } from '../ffmpeg';

export type Severity = 'erro' | 'aviso';

export interface Finding {
  severity: Severity;
  message: string;
}

/** FAT32 can't hold a file of 4 GiB or more. */
export const FAT32_MAX_BYTES = 4 * 1024 ** 3 - 1;
const MAX_BITRATE = 20_000_000;
const OLD_TV_LEVEL = 41;
const GOOD_PROFILES = new Set(['baseline', 'constrained baseline', 'main', 'high']);
/** Containers and codecs that many TVs play but not all: worth a warning, not an error. */
const SOME_CONTAINERS: Record<string, string> = { matroska: 'MKV', avi: 'AVI', mpegts: 'TS', asf: 'WMV/ASF', mpeg: 'MPEG-PS' };
const SOME_CODECS: Record<string, string> = {
  hevc: 'H.265 (HEVC): só TVs de 2016 em diante costumam tocar',
  mpeg4: 'MPEG-4 Parte 2 (DivX/Xvid): TVs antigas costumam tocar, algumas novas não',
  mpeg2video: 'MPEG-2: a maioria toca, mas os arquivos ficam grandes',
  vp9: 'VP9: só TVs mais novas tocam',
  av1: 'AV1: só TVs bem novas tocam',
  wmv3: 'WMV: algumas TVs tocam',
  vc1: 'VC-1: algumas TVs tocam',
};

const error = (message: string): Finding => ({ severity: 'erro', message });
const warning = (message: string): Finding => ({ severity: 'aviso', message });

/** Problems of a file name on a FAT32 or exFAT stick, as the TV's file browser sees it. */
export function checkName(name: string): Finding[] {
  const findings: Finding[] = [];
  if (/[<>:"/\\|?*\x00-\x1f]/.test(name)) findings.push(error('o nome tem caracteres que pendrives FAT32 não aceitam (< > : " / \\ | ? *)'));
  if (name.length > 255) findings.push(error('o nome passa de 255 caracteres'));
  if (name.startsWith('.')) findings.push(error('nomes que começam com ponto ficam ocultos na TV'));
  if (/[^\x20-\x7e]/.test(name)) findings.push(warning('o nome tem acentos ou símbolos: algumas TVs mostram letras trocadas (o vídeo toca igual)'));
  return findings;
}

export interface FileFacts {
  bytes: number;
  info: MediaInfo;
  /** The index (moov) comes before the media (mdat): the TV can start and seek without reading the whole file. */
  moovFirst: boolean | null;
  /** The stick's file system as the system names it ("FAT32", "exFAT", "NTFS"...), or null when unknown. */
  fileSystem: string | null;
}

/** Problems of one video for a TV's USB player. */
export function checkVideo({ bytes, info, moovFirst, fileSystem }: FileFacts): Finding[] {
  const findings: Finding[] = [];
  const fat32 = fileSystem === null || /fat32|vfat|msdos|^fat$/i.test(fileSystem);
  if (bytes > FAT32_MAX_BYTES) {
    findings.push(fat32 ? error('o arquivo tem 4 GB ou mais: não cabe num pendrive FAT32') : warning('o arquivo tem 4 GB ou mais: só funciona em pendrive exFAT/NTFS, que TVs antigas não leem'));
  }
  if (!/mp4|mov/.test(info.container)) {
    const some = Object.entries(SOME_CONTAINERS).find(([key]) => info.container.split(',').includes(key))?.[1];
    findings.push(
      some
        ? warning(`arquivo ${some}: muitas TVs tocam, mas MP4 é o que todas tocam ("tv-gominho converter" troca)`)
        : error(`formato ${info.container || 'desconhecido'}: TVs não tocam; converta para MP4 com "tv-gominho converter"`),
    );
  }
  if (moovFirst === false) findings.push(warning('o índice do vídeo está no fim do arquivo: a TV pode demorar a abrir ou não conseguir avançar (falta "faststart")'));

  const video = info.video;
  if (!video) {
    findings.push(error('o arquivo não tem vídeo'));
  } else {
    if (SOME_CODECS[video.codec]) findings.push(warning(`vídeo em ${SOME_CODECS[video.codec]}; H.264 é o mais seguro`));
    else if (video.codec !== 'h264') findings.push(error(`vídeo em ${video.codec}: TVs não tocam; use H.264`));
    if (video.codec === 'h264') {
      if (video.profile && !GOOD_PROFILES.has(video.profile.toLowerCase())) findings.push(error(`perfil H.264 "${video.profile}": TVs tocam Baseline, Main e High`));
      if (video.level && video.level > OLD_TV_LEVEL) findings.push(warning(`nível H.264 ${video.level / 10}: TVs mais antigas vão até 4.1`));
    }
    if (video.pixFmt && video.pixFmt !== 'yuv420p' && video.pixFmt !== 'yuvj420p') findings.push(error(`cores em ${video.pixFmt}: TVs só tocam yuv420p (8 bits)`));
    if (video.width > 1920 || video.height > 1080) findings.push(warning(`imagem ${video.width}x${video.height}: maior que Full HD, só TVs 4K tocam`));
    if (video.frameRate && video.frameRate > 30.5) findings.push(warning(`${Math.round(video.frameRate)} quadros por segundo: TVs mais antigas vão até 30`));
  }
  const rate = info.bitRate ?? (info.duration ? (bytes * 8) / info.duration : null);
  if (rate && rate > MAX_BITRATE) findings.push(warning(`taxa média de ${(rate / 1e6).toFixed(0)} Mb/s: acima dos 20 Mb/s que TVs Full HD garantem`));

  const audio = info.audio[0];
  if (!audio) {
    findings.push(warning('o arquivo não tem som'));
  } else {
    if (audio.codec === 'aac') {
      if (audio.profile && !/^lc$/i.test(audio.profile)) findings.push(warning(`som AAC ${audio.profile}: o mais seguro é AAC-LC`));
    } else if (audio.codec === 'mp3') {
      // fine everywhere
    } else if (audio.codec === 'ac3' || audio.codec === 'eac3') {
      findings.push(warning(`som em ${audio.codec.toUpperCase()}: algumas TVs tocam o vídeo mudo; AAC é o mais seguro`));
    } else {
      findings.push(error(`som em ${audio.codec}: TVs não tocam pelo USB; use AAC`));
    }
    if (audio.channels > 2) findings.push(warning(`som com ${audio.channels} canais: o estéreo é o mais seguro`));
    if (audio.sampleRate && audio.sampleRate > 48_000) findings.push(warning(`som a ${audio.sampleRate / 1000} kHz: use 48 kHz ou menos`));
  }
  return findings;
}

/** Problems of the stick's file system. */
export function checkFileSystem(fileSystem: string | null): Finding[] {
  if (fileSystem === null) return [];
  if (/fat32|vfat|msdos|^fat$/i.test(fileSystem)) return [];
  if (/exfat/i.test(fileSystem)) return [warning('pendrive em exFAT: TVs de antes de ~2012 não leem; FAT32 é o que toda TV lê')];
  if (/ntfs|fuseblk/i.test(fileSystem)) return [warning(`pendrive em ${fileSystem}: muitas TVs não leem (ou só leem, sem tocar tudo); formate em FAT32`)];
  return [warning(`sistema de arquivos ${fileSystem}: TVs leem FAT32 (e as mais novas, exFAT)`)];
}

/**
 * Whether the MP4 index (moov) comes before the media (mdat), reading only the top-level box headers.
 * Null when the file is not an MP4 that can be walked.
 */
export async function moovBeforeMdat(file: string): Promise<boolean | null> {
  const handle = await open(file, 'r');
  try {
    const { size } = await handle.stat();
    const header = Buffer.alloc(16);
    let offset = 0;
    for (let boxes = 0; offset + 8 <= size && boxes < 64; boxes++) {
      await handle.read(header, 0, 16, offset);
      let boxSize = header.readUInt32BE(0);
      const type = header.toString('latin1', 4, 8);
      if (boxSize === 1) boxSize = Number(header.readBigUInt64BE(8));
      else if (boxSize === 0) boxSize = size - offset;
      if (type === 'moov') return true;
      if (type === 'mdat') return false;
      if (boxSize < 8) return null;
      offset += boxSize;
    }
    return null;
  } finally {
    await handle.close();
  }
}
