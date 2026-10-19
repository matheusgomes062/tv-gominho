import { defineConfig } from 'vite';

// The CLI is bundled into a single file because Node can run TypeScript but
// can't resolve the core's extensionless imports ('./library'). SSR mode
// targets Node: built-ins stay external, everything else (the core, `yaml`)
// is inlined, so the output needs no node_modules.
export default defineConfig({
  build: {
    ssr: 'src/main.ts',
    target: 'node22',
    minify: false,
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
