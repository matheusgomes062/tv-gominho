// HTTP pieces shared by `tv-gominho servir` and the interface's dev server:
// library files with Range support, the library listing, and the app's static
// files with precompressed .br/.gz variants. Only Node built-ins.

import { createReadStream } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import path from 'node:path';
import { gzipSync } from 'node:zlib';

export const LIBRARY_LIST_PATH = '/__biblioteca/lista';
export const LIBRARY_FILE_PATH = '/__biblioteca/arquivo/';

export const CONTENT_TYPES: Record<string, string> = {
  '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.yaml': 'text/yaml; charset=utf-8', '.yml': 'text/yaml; charset=utf-8', '.txt': 'text/plain; charset=utf-8',
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.ico': 'image/x-icon',
};

/**
 * What library files may be served as. Library folders hold whatever people downloaded:
 * an .html or .svg among the episodes would otherwise run as a page on the app's own
 * origin. Media, plain images and text only; everything else is a download.
 */
export const LIBRARY_TYPES: Record<string, string> = {
  '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif',
  '.yaml': 'text/plain; charset=utf-8', '.yml': 'text/plain; charset=utf-8', '.txt': 'text/plain; charset=utf-8',
};

const typeOf = (file: string, types: Record<string, string> = CONTENT_TYPES) => types[path.extname(file).toLowerCase()] ?? 'application/octet-stream';

/** A path under `root` from a URL path, or null when it is malformed or leaves `root`. */
export function resolveInside(root: string, urlPath: string): string | null {
  let relative: string;
  try {
    relative = decodeURIComponent(urlPath.split('?')[0]!.replace(/^\/+/, ''));
  } catch {
    return null; // malformed %-escape
  }
  if (relative.includes('\0')) return null;
  const file = path.resolve(root, relative);
  const inside = path.relative(root, file);
  if (inside.startsWith('..') || path.isAbsolute(inside)) return null;
  return file;
}

function finish(res: ServerResponse, status: number) {
  res.statusCode = status;
  res.end();
}

/**
 * Sends a file with Range support (videos are seeked by byte ranges). Every
 * aborted request closes its read stream: a browser seeking through many videos
 * aborts a lot of them, and leaked handles end in EMFILE.
 */
export async function sendFile(req: IncomingMessage, res: ServerResponse, file: string, cache = 'no-cache', types = CONTENT_TYPES): Promise<void> {
  const info = await stat(file).catch(() => null);
  if (!info?.isFile()) return finish(res, 404);
  res.setHeader('Content-Type', typeOf(file, types));
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('Cache-Control', cache);
  let start = 0;
  let end = info.size - 1;
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? '');
  if (range && (range[1] || range[2])) {
    if (range[1]) {
      start = Number(range[1]);
      if (range[2]) end = Math.min(Number(range[2]), end);
    } else {
      // Suffix range "bytes=-N": the last N bytes.
      start = Math.max(0, info.size - Number(range[2]));
    }
    if (start > end || start >= info.size) {
      res.setHeader('Content-Range', `bytes */${info.size}`);
      return finish(res, 416);
    }
    res.statusCode = 206;
    res.setHeader('Content-Range', `bytes ${start}-${end}/${info.size}`);
  }
  res.setHeader('Content-Length', end - start + 1);
  // An empty file has nothing to stream (and createReadStream rejects end: -1).
  if (req.method === 'HEAD' || end < start) {
    res.end();
    return;
  }
  const stream = createReadStream(file, { start, end });
  stream.on('error', () => res.destroy());
  res.on('close', () => stream.destroy());
  stream.pipe(res);
}

/** Every file under `dir` (no dotfiles), as '/'-separated relative paths. */
export async function listFiles(dir: string, prefix = ''): Promise<string[]> {
  const files: string[] = [];
  let entries;
  try {
    entries = await readdir(path.join(dir, prefix), { withFileTypes: true });
  } catch {
    return files; // unreadable folder: skip it
  }
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) files.push(...(await listFiles(dir, relative)));
    else if (entry.isFile()) files.push(relative);
  }
  return files;
}

const acceptsGzip = (req: IncomingMessage) => /\bgzip\b/.test(String(req.headers['accept-encoding'] ?? ''));

/** A library file: only LIBRARY_TYPES, never rendered as a page (sandboxed even if a browser tried). */
export function sendLibraryFile(req: IncomingMessage, res: ServerResponse, file: string): Promise<void> {
  res.setHeader('Content-Security-Policy', 'sandbox');
  if (!LIBRARY_TYPES[path.extname(file).toLowerCase()]) res.setHeader('Content-Disposition', 'attachment');
  return sendFile(req, res, file, 'no-cache', LIBRARY_TYPES);
}

/** JSON, gzipped when the client takes it and it is worth it (a big library lists thousands of paths). */
export function sendJson(req: IncomingMessage, res: ServerResponse, value: unknown, status = 200): void {
  const body = Buffer.from(JSON.stringify(value), 'utf8');
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Vary', 'Accept-Encoding');
  if (body.length > 1024 && acceptsGzip(req)) {
    const zipped = gzipSync(body);
    res.setHeader('Content-Encoding', 'gzip');
    res.setHeader('Content-Length', zipped.length);
    res.end(req.method === 'HEAD' ? undefined : zipped);
    return;
  }
  res.setHeader('Content-Length', body.length);
  res.end(req.method === 'HEAD' ? undefined : body);
}

/** The body of LIBRARY_LIST_PATH. */
export async function libraryListing(dir: string) {
  return { name: path.basename(dir), base: LIBRARY_FILE_PATH, files: await listFiles(dir) };
}

/**
 * The app's static files. The build leaves .br and .gz next to the text files
 * (see the interface's vite.config.ts); the smallest one the client accepts is
 * sent as is, with no compression work per request.
 */
export async function sendStatic(req: IncomingMessage, res: ServerResponse, root: string, urlPath: string): Promise<void> {
  let file = resolveInside(root, urlPath === '/' ? '/index.html' : urlPath);
  if (!file) return finish(res, 400);
  if (!(await stat(file).catch(() => null))?.isFile()) {
    if (path.extname(file)) return finish(res, 404);
    file = path.join(root, 'index.html'); // app route without a file: the app itself
  }
  // Hashed assets never change; index.html must be checked every time.
  const cache = urlPath.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache';
  const accepted = String(req.headers['accept-encoding'] ?? '');
  for (const [encoding, suffix] of [['br', '.br'], ['gzip', '.gz']] as const) {
    if (!new RegExp(`\\b${encoding}\\b`).test(accepted)) continue;
    const variant = await stat(file + suffix).catch(() => null);
    if (!variant?.isFile()) continue;
    res.statusCode = 200;
    res.setHeader('Content-Type', typeOf(file));
    res.setHeader('Content-Encoding', encoding);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Length', variant.size);
    res.setHeader('Cache-Control', cache);
    res.setHeader('Vary', 'Accept-Encoding');
    if (req.method === 'HEAD') {
      res.end();
      return;
    }
    const stream = createReadStream(file + suffix);
    stream.on('error', () => res.destroy());
    res.on('close', () => stream.destroy());
    stream.pipe(res);
    return;
  }
  return sendFile(req, res, file, cache);
}
