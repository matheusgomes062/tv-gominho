// npm run avaliar:jev: runs `organizar`'s evaluation against the real Jev
// (pacotes/cli/src/organizar/avaliacao.test.ts). Needs TYPESAFE_API_KEY (in .env)
// and costs API tokens, which is why `npm test` skips it.

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
if (existsSync(`${root}.env`)) process.loadEnvFile(`${root}.env`);
if (!process.env.TYPESAFE_API_KEY) {
  console.error('Coloque TYPESAFE_API_KEY=<chave> no arquivo .env da raiz do projeto.');
  process.exit(1);
}
const vitest = fileURLToPath(new URL('../node_modules/vitest/vitest.mjs', import.meta.url));
const { status } = spawnSync(process.execPath, [vitest, 'run', 'pacotes/cli/src/organizar/avaliacao.test.ts', '--silent=false'], {
  cwd: root,
  stdio: 'inherit',
  env: { ...process.env, JEV_AVALIAR: '1' },
});
process.exit(status ?? 1);
