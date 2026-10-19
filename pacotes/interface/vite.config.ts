import { existsSync } from 'node:fs';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { brotliCompressSync, constants, gzipSync } from 'node:zlib';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';
import { LIBRARY_FILE_PATH, LIBRARY_LIST_PATH, libraryListing, resolveInside, sendFile, sendJson } from '../cli/src/serve/http.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../..');

/**
 * Development only: serves a library folder from disk so the app can be tested
 * without the folder picker. Defaults to exemplo/biblioteca (see `npm run exemplo`);
 * override with TV_GOMINHO_BIBLIOTECA. Same routes as `tv-gominho servir`.
 */
function devLibrary(): Plugin {
  const dir = path.resolve(process.env.TV_GOMINHO_BIBLIOTECA ?? path.join(repoRoot, 'exemplo/biblioteca'));

  return {
    name: 'tv-gominho-dev-library',
    apply: 'serve',
    configureServer(server) {
      // Library files, with Range support. Served here rather than through /@fs: a browser
      // seeking through ~100 videos aborts many requests, and every aborted read stream must
      // be closed (or the server runs out of file handles and crashes with EMFILE).
      server.middlewares.use(LIBRARY_FILE_PATH, (req, res) => {
        const file = resolveInside(dir, req.url ?? '');
        if (!file) {
          res.statusCode = 400;
          res.end();
          return;
        }
        // A throw here would be an unhandled rejection and stop the server.
        sendFile(req, res, file).catch(() => res.destroy());
      });

      server.middlewares.use(LIBRARY_LIST_PATH, (req, res) => {
        if (!existsSync(dir)) {
          sendJson(req, res, { error: `Pasta não encontrada: ${dir}. Rode "npm run exemplo".` }, 404);
          return;
        }
        libraryListing(dir).then((listing) => sendJson(req, res, listing), () => res.destroy());
      });
    },
  };
}

const COMPRESSIBLE = /\.(?:js|mjs|css|html|svg|json|txt)$/;

/**
 * Leaves .br and .gz copies next to the built text files, for `tv-gominho servir`
 * to send as they are: the app's ~430 KB of JavaScript travel as ~120 KB. Fonts
 * (woff2) and videos are compressed already and get nothing from it.
 */
function precompress(): Plugin {
  let outDir = '';
  return {
    name: 'tv-gominho-precompress',
    apply: 'build',
    configResolved(config) {
      outDir = path.resolve(config.root, config.build.outDir);
    },
    async closeBundle() {
      const entries = await readdir(outDir, { recursive: true, withFileTypes: true });
      for (const entry of entries) {
        const file = path.join(entry.parentPath, entry.name);
        if (!entry.isFile() || !COMPRESSIBLE.test(file)) continue;
        const data = await readFile(file);
        if (data.length < 1024) continue;
        const br = brotliCompressSync(data, { params: { [constants.BROTLI_PARAM_QUALITY]: 11, [constants.BROTLI_PARAM_SIZE_HINT]: data.length } });
        const gz = gzipSync(data, { level: 9 });
        if (br.length < data.length * 0.9) await writeFile(`${file}.br`, br);
        if (gz.length < data.length * 0.9) await writeFile(`${file}.gz`, gz);
      }
    },
  };
}

/**
 * Opening index.html straight from a USB stick (file://) needs a classic script:
 * browsers refuse module scripts and `crossorigin` loads from file:// (origin "null").
 * The app is one chunk, so an IIFE bundle with a deferred <script> loads the same way.
 */
function classicScript(): Plugin {
  return {
    name: 'tv-gominho-classic-script',
    apply: 'build',
    enforce: 'post',
    transformIndexHtml(html) {
      return html.replace(/<script type="module" crossorigin/g, '<script defer').replace(/ crossorigin(?=[\s>])/g, '');
    },
  };
}

export default defineConfig({
  plugins: [react(), devLibrary(), precompress(), classicScript()],
  // Relative asset paths, so the build also works when opened from a USB stick or subfolder.
  base: './',
  build: {
    rolldownOptions: { output: { format: 'iife' } },
    // No module preload polyfill: there is a single chunk and the script is not a module.
    modulePreload: false,
  },
});
