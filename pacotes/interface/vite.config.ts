import { readdir, stat } from 'node:fs/promises';
import { createReadStream, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../..');

const TYPES: Record<string, string> = {
  '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif',
  '.yaml': 'text/yaml; charset=utf-8', '.yml': 'text/yaml; charset=utf-8', '.txt': 'text/plain; charset=utf-8',
};

/**
 * Development only: serves a library folder from disk so the app can be tested
 * without the folder picker. Defaults to exemplo/biblioteca (see `npm run exemplo`);
 * override with TV_CHUVISCO_BIBLIOTECA.
 */
function devLibrary(): Plugin {
  const dir = path.resolve(process.env.TV_CHUVISCO_BIBLIOTECA ?? path.join(repoRoot, 'exemplo/biblioteca'));

  async function walk(base: string, prefix = ''): Promise<string[]> {
    const files: string[] = [];
    for (const entry of await readdir(path.join(base, prefix), { withFileTypes: true })) {
      if (entry.name.startsWith('.')) continue;
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) files.push(...(await walk(base, relative)));
      else if (entry.isFile()) files.push(relative);
    }
    return files;
  }

  return {
    name: 'tv-chuvisco-dev-library',
    apply: 'serve',
    configureServer(server) {
      // Library files, with Range support. Served here rather than through /@fs: a browser
      // seeking through ~100 videos aborts many requests, and every aborted read stream must
      // be closed (or the server runs out of file handles and crashes with EMFILE).
      server.middlewares.use('/__biblioteca/arquivo/', async (req, res) => {
        let relative: string;
        try {
          relative = decodeURIComponent((req.url ?? '').split('?')[0]!.replace(/^\/+/, ''));
        } catch {
          // Malformed %-escape: a throw here would be an unhandled rejection and stop the server.
          res.statusCode = 400;
          res.end();
          return;
        }
        const file = path.resolve(dir, relative);
        const inside = path.relative(dir, file);
        const info = inside && !inside.startsWith('..') && !path.isAbsolute(inside) ? await stat(file).catch(() => null) : null;
        if (!info?.isFile()) {
          res.statusCode = 404;
          res.end();
          return;
        }
        res.setHeader('Content-Type', TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream');
        res.setHeader('Accept-Ranges', 'bytes');
        res.setHeader('Cache-Control', 'no-cache');
        let start = 0;
        let end = info.size - 1;
        const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? '');
        if (range) {
          if (range[1]) {
            start = Number(range[1]);
            if (range[2]) end = Math.min(Number(range[2]), end);
          } else if (range[2]) {
            // Suffix range "bytes=-N": the last N bytes.
            start = Math.max(0, info.size - Number(range[2]));
          }
          if (start > end || start >= info.size) {
            res.statusCode = 416;
            res.setHeader('Content-Range', `bytes */${info.size}`);
            res.end();
            return;
          }
          res.statusCode = 206;
          res.setHeader('Content-Range', `bytes ${start}-${end}/${info.size}`);
        }
        res.setHeader('Content-Length', end - start + 1);
        if (req.method === 'HEAD') {
          res.end();
          return;
        }
        const stream = createReadStream(file, { start, end });
        stream.on('error', () => res.destroy());
        res.on('close', () => stream.destroy());
        stream.pipe(res);
      });

      server.middlewares.use('/__biblioteca/lista', async (_req, res) => {
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        if (!existsSync(dir)) {
          res.statusCode = 404;
          res.end(JSON.stringify({ error: `Pasta não encontrada: ${dir}. Rode "npm run exemplo".` }));
          return;
        }
        res.end(
          JSON.stringify({
            name: path.basename(dir),
            base: '/__biblioteca/arquivo/',
            files: await walk(dir),
          }),
        );
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), devLibrary()],
  // Relative asset paths, so the build also works when opened from a USB stick or subfolder.
  base: './',
});
