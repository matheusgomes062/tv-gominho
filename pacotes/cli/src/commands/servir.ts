import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { isIP } from 'node:net';
import { hostname, networkInterfaces } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CliError, UsageError } from '../errors';
import { helpOptions, intOption, parseOptions } from '../options';
import { anthropicApiKey, anthropicUrl, ANTHROPIC_MODEL, createAnthropicProvider } from '../ia/anthropic';
import { CAPABILITIES_PATH, createEditor, MAX_BODY, newPin, type EditOptions } from '../serve/edit';
import { createAssistant, IA_PER_HOUR } from '../serve/ia';
import { createIaConfig, type IaConfig } from '../serve/ia-config';
import { appDataDir, createKeyStore } from '../ia/chave';
import { LIBRARY_FILE_PATH, LIBRARY_LIST_PATH, libraryListing, resolveInside, sendJson, sendLibraryFile, sendStatic } from '../serve/http';
import type { Command } from './types';

const OPTIONS = {
  ...helpOptions,
  porta: { type: 'string', short: 'p' },
  rede: { type: 'boolean' },
  abrir: { type: 'boolean' },
  editar: { type: 'boolean' },
  ia: { type: 'boolean' },
  'ia-modelo': { type: 'string' },
  interface: { type: 'string' },
} as const;

export const DEFAULT_PORT = 8080;

const HELP = `Uso:
  tv-gominho servir <biblioteca> [opções]

Abre a TV Gominho como um site, já com a biblioteca carregada: é só abrir o endereço
no navegador (Chrome, Edge, Firefox, Chromium do Raspberry Pi, navegador da TV...).
Não precisa escolher pasta. Os arquivos não saem do computador e, sem --editar, nada é gravado.

Opções:
  --porta, -p <n>       porta. Padrão: ${DEFAULT_PORT}
  --rede                aceita outros aparelhos da rede (TV, celular, outro PC). Sem ela, só
                        este computador abre o endereço
  --abrir               abre o navegador neste computador
  --editar              deixa salvar canais pelo app ("Criar uma programação"). Mostra um PIN aqui;
                        cada aparelho digita o PIN uma vez. Só grava grades/<nome>.yaml e
                        nao-passar.yaml, nada mais
  --ia-modelo <id>      outro modelo Claude para o "Pedir para a IA". Padrão: ${ANTHROPIC_MODEL}
  --ia                  liga a IA já ao abrir, sem passar pelas configurações (precisa de chave)

IA (opcional, desligada por padrão): no navegador deste computador, abra Configurações,
Assistente de IA, cole a sua chave da Anthropic e ligue. A chave fica numa pasta de dados
do app neste computador (nunca na biblioteca) e custa dinheiro na sua conta a cada pedido.
Saem títulos, durações, a lista de programas e o pedido; nunca vídeos. Aparelhos da rede
usam a IA com o PIN. A variável ANTHROPIC_API_KEY, se existir, vale no lugar da chave salva.
  --interface <pasta>   pasta do app compilado (padrão: a que vem com a ferramenta)
  --ajuda               mostra esta ajuda

Para o Raspberry Pi em modo quiosque, veja docs/raspberry-pi.md.

Exemplos:
  tv-gominho servir ./biblioteca --abrir
  tv-gominho servir E:\\biblioteca --rede --porta 8000
  tv-gominho servir ./biblioteca --rede --editar
  npm run cli -- servir ./biblioteca --editar --ia   (chave em ANTHROPIC_API_KEY, no arquivo .env)`;

export const servirCommand: Command = {
  name: 'servir',
  summary: 'Abre a TV Gominho no navegador (ou em outros aparelhos da rede) já com a biblioteca',
  help: HELP,
  async run(argv, { signal }) {
    const { values, positionals } = parseOptions(argv, OPTIONS);
    if (values.ajuda) {
      console.log(HELP);
      return 0;
    }
    if (positionals.length !== 1) throw new UsageError('Informe a pasta da biblioteca: tv-gominho servir <biblioteca>. Veja "tv-gominho servir --ajuda".');
    const library = path.resolve(positionals[0]!);
    if (!(await stat(library).catch(() => null))?.isDirectory()) throw new CliError(`A pasta "${positionals[0]}" não existe ou não é uma pasta.`);
    const app = findInterface(values.interface);
    const port = intOption('--porta', values.porta, 1, 65535) ?? DEFAULT_PORT;
    const host = values.rede ? '0.0.0.0' : '127.0.0.1';

    const log = (message: string) => console.log(message);
    const model = values['ia-modelo']?.trim();
    if (model !== undefined && !/^[a-z0-9][a-z0-9.@:_-]{0,99}$/i.test(model)) throw new UsageError('O nome do modelo em --ia-modelo não parece válido.');
    let url: string | undefined;
    try {
      url = anthropicUrl();
    } catch (error) {
      throw new CliError((error as Error).message);
    }

    // Pairing is always there: the AI can be turned on from the app while the server runs, and then only a paired
    // device (or this computer's own browser) may spend the key.
    const pin = newPin();
    let pinShown = false;
    const showPin = () => {
      if (pinShown) return;
      pinShown = true;
      console.log(`PIN para parear um aparelho: ${pin}`);
    };
    const ia = await createIaConfig({
      store: createKeyStore(appDataDir()),
      library,
      envKey: anthropicApiKey(),
      startOn: values.ia,
      model: model ?? ANTHROPIC_MODEL,
      provider: (apiKey) => createAnthropicProvider({ apiKey, model, url }),
      log,
      onAvailable: () => {
        console.log(`IA: LIGADA. Só aparelhos pareados pedem, no máximo ${IA_PER_HOUR} por hora.`);
        showPin();
      },
    });
    const assistant = createAssistant(library, { provider: () => ia.provider(), log });
    const server = createLibraryServer(library, app, { pin, log, write: Boolean(values.editar), assistant, isLocal: ia.isLocal }, ia);
    await new Promise<void>((resolve, reject) => {
      server.once('error', (error: NodeJS.ErrnoException) =>
        reject(error.code === 'EADDRINUSE' ? new CliError(`A porta ${port} já está em uso. Escolha outra com --porta.`) : error),
      );
      server.listen(port, host, resolve);
    });

    const local = `http://localhost:${port}/`;
    console.log(`TV Gominho no ar, com a biblioteca ${library}`);
    console.log(`  Neste computador: ${local}`);
    if (values.rede) for (const address of lanAddresses()) console.log(`  Na rede:          http://${address}:${port}/`);
    if (values.editar) {
      console.log(`Salvar canais pelo app: LIGADO.`);
      console.log(`  Só quem digitar o PIN grava, e só grades/<nome>.yaml e nao-passar.yaml (até ${MAX_BODY / 1024} KB).`);
    }
    if (ia.available()) {
      console.log(`IA: LIGADA (Anthropic, modelo ${model ?? ANTHROPIC_MODEL}). Cada pedido custa dinheiro na sua conta.`);
      console.log(`  Só aparelhos pareados pedem, no máximo ${IA_PER_HOUR} por hora. Saem títulos, durações, a lista de programas e o pedido; nunca vídeos.`);
    } else if (values.ia) {
      console.log('IA: sem chave. Coloque a chave em Configurações, Assistente de IA, no navegador deste computador (veja docs/ferramentas.md).');
    }
    if (values.editar || ia.available()) showPin();
    console.log('Ctrl+C para desligar.');
    if (values.abrir) openBrowser(local);

    await new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve(), { once: true }));
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    console.log('Desligado.');
    return 0;
  },
};

/**
 * Host names the server answers to. A web page elsewhere can point a domain of its own
 * at 127.0.0.1 or a LAN address (DNS rebinding) and read the library through it; such
 * requests carry that domain in Host. IP addresses, localhost and this machine's own
 * names (raspberrypi, raspberrypi.local) are what people type.
 */
export function allowedHost(host: string | undefined, machineName = hostname()): boolean {
  if (!host) return false;
  const name = host.replace(/:\d+$/, '').replace(/^\[|\]$/g, '').toLowerCase();
  if (isIP(name)) return true;
  const machine = machineName.toLowerCase();
  return name === 'localhost' || name.endsWith('.localhost') || name === machine || name === `${machine}.local`;
}

/**
 * The server: the app at /, the library under /__biblioteca/. Read-only, unless `edit` is given: then
 * the routes of serve/edit.ts also take a PIN and the files a channel is made of.
 */
export function createLibraryServer(library: string, app: string, edit?: EditOptions, ia?: IaConfig): Server {
  const editor = edit ? createEditor(library, edit) : null;
  return createServer((req, res) => {
    const [url, query = ''] = (req.url ?? '/').split('?') as [string, string?];
    if (!allowedHost(req.headers.host)) {
      res.statusCode = 421;
      res.end('Use o endereço que o tv-gominho servir mostrou (IP ou localhost).');
      return;
    }
    const handle = async () => {
      if (url === CAPABILITIES_PATH && (req.method === 'GET' || req.method === 'HEAD')) {
        // configIa: the app can show and change the AI's settings through this server (serve/ia-config.ts).
        return sendJson(req, res, { ...(editor?.capabilities(req) ?? { editar: false, ia: false, pareado: false }), configIa: ia !== undefined });
      }
      if (ia && (await ia.handle(req, res, url))) return;
      if (editor && (await editor.handle(req, res, url, query))) return;
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.statusCode = 405;
        res.end();
        return;
      }
      if (url === LIBRARY_LIST_PATH) return sendJson(req, res, await libraryListing(library));
      if (url.startsWith(LIBRARY_FILE_PATH)) {
        const relative = url.slice(LIBRARY_FILE_PATH.length);
        const file = resolveInside(library, relative);
        // Hidden files and folders (.originais, .tv-gominho-tmp) are not part of the library.
        if (!file || path.relative(library, file).split(path.sep).some((part) => part.startsWith('.'))) {
          res.statusCode = 404;
          res.end();
          return;
        }
        return sendLibraryFile(req, res, file);
      }
      return sendStatic(req, res, app, url);
    };
    handle().catch(() => {
      if (!res.headersSent) res.statusCode = 500;
      res.end();
    });
  });
}

/** The built app: next to the bundle in a release, or the interface package's dist in the repository. */
function findInterface(option: string | undefined): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = option !== undefined ? [path.resolve(option)] : [path.join(here, 'interface'), path.resolve(here, '../../interface/dist')];
  const found = candidates.find((dir) => existsSync(path.join(dir, 'index.html')));
  if (!found) {
    throw new CliError(
      option !== undefined
        ? `Não achei o app em "${option}" (falta index.html).`
        : 'Não achei o app compilado. No repositório, rode "npm run build" antes; ou informe a pasta com --interface.',
    );
  }
  return found;
}

function lanAddresses(): string[] {
  return Object.values(networkInterfaces())
    .flat()
    .filter((info) => info && info.family === 'IPv4' && !info.internal)
    .map((info) => info!.address);
}

function openBrowser(url: string) {
  // On Windows, cmd.exe by its full path and run from the system folder: a bare "cmd" would also be
  // looked up in the current folder, where a stick or a download could plant one.
  const system = process.env.SystemRoot ?? 'C:\\Windows';
  const [command, args] =
    process.platform === 'win32'
      ? [path.join(system, 'System32', 'cmd.exe'), ['/c', 'start', '""', url]]
      : process.platform === 'darwin'
        ? ['/usr/bin/open', [url]]
        : ['xdg-open', [url]];
  try {
    spawn(command, args as string[], { stdio: 'ignore', detached: true, cwd: process.platform === 'win32' ? system : '/' }).on('error', () => {}).unref();
  } catch {
    // no browser to open: the address is on screen
  }
}
