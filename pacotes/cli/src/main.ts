import { commands } from './commands';
import { CliError, UsageError } from './errors';
import { mainHelp } from './help';

const HELP_WORDS = new Set(['ajuda', '--ajuda', '-h', '--help', 'help']);

async function main(argv: string[]): Promise<number> {
  const [name, ...rest] = argv;

  if (name === undefined || HELP_WORDS.has(name)) {
    console.log(mainHelp(commands));
    return name === undefined ? 2 : 0;
  }

  const command = commands.find((candidate) => candidate.name === name);
  if (!command) throw new UsageError(`Comando desconhecido: "${name}". Veja "tv-gominho ajuda".`);

  // Ctrl+C asks the running command to stop and clean up; a second one quits right away.
  const controller = new AbortController();
  process.on('SIGINT', () => {
    if (controller.signal.aborted) process.exit(130);
    console.log('\nInterrompendo... (Ctrl+C de novo para sair na hora)');
    controller.abort();
  });

  return command.run(rest, { signal: controller.signal });
}

main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    if (error instanceof CliError) {
      console.error(`Erro: ${error.message}`);
      process.exitCode = error.exitCode;
    } else {
      console.error('Erro inesperado:', error);
      process.exitCode = 1;
    }
  },
);
