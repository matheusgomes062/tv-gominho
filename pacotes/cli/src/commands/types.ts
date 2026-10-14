export interface CommandContext {
  /** Aborted when the user presses Ctrl+C. Commands stop what they are doing and clean up. */
  signal: AbortSignal;
}

export interface Command {
  name: string;
  /** One line for the command list. */
  summary: string;
  /** Full `tv-chuvisco <name> --ajuda` text (pt-BR). */
  help: string;
  /** Receives the arguments after the command name; resolves to the process exit code. */
  run(argv: string[], context: CommandContext): Promise<number>;
}
