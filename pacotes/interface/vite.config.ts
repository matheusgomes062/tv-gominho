import { readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../..');

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
    config: () => ({ server: { fs: { allow: [repoRoot, dir] } } }),
    configureServer(server) {
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
            base: `/@fs/${dir.replace(/\\/g, '/').replace(/^\//, '')}/`,
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
