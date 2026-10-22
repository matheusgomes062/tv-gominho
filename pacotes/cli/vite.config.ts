import { defineConfig } from 'vite';

// The CLI is bundled into a single file because Node can run TypeScript but
// can't resolve the core's extensionless imports ('./library'). SSR mode
// targets Node: built-ins stay external, everything else (the core, `yaml`)
// is inlined, so the output needs no node_modules.
export default defineConfig({
  plugins: [
    {
      // `organizar` needs only the titles of docs/programas-tv-globinho.json, not its sources and notes (~20 KB).
      name: 'programas-titulos',
      enforce: 'pre',
      transform(code, id) {
        if (!id.endsWith('programas-tv-globinho.json')) return null;
        const list = JSON.parse(code) as { titulo: string; titulo_original?: string }[];
        return JSON.stringify(list.map(({ titulo, titulo_original }) => ({ titulo, titulo_original })));
      },
    },
  ],
  build: {
    ssr: 'src/main.ts',
    target: 'node22',
    // Minified: the whole tool is one ~245 KB file that fits anywhere, a USB stick included.
    minify: true,
    outDir: 'dist',
    emptyOutDir: true,
    rolldownOptions: {
      output: {
        entryFileNames: 'tv-gominho.mjs',
        banner: '#!/usr/bin/env node',
      },
    },
  },
  ssr: { noExternal: true },
});
