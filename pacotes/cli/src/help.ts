import type { Command } from './commands/types';

export function mainHelp(commands: Command[]): string {
  const width = Math.max(...commands.map((command) => command.name.length), 'ajuda'.length);
  const rows = [...commands.map((command) => [command.name, command.summary] as const), ['ajuda', 'Mostra esta ajuda'] as const];
  return `TV Chuvisco: ferramentas de linha de comando

Uso:
  tv-chuvisco <comando> [opções]

Comandos:
${rows.map(([name, summary]) => `  ${name.padEnd(width)}  ${summary}`).join('\n')}

Use "tv-chuvisco <comando> --ajuda" para ver as opções de cada comando.
Documentação: docs/ferramentas.md`;
}
