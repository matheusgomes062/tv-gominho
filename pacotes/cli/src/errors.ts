/** An error whose message is meant to be shown to the user as is (pt-BR). */
export class CliError extends Error {
  constructor(
    message: string,
    readonly exitCode = 1,
  ) {
    super(message);
    this.name = 'CliError';
  }
}

/** Wrong command line: exit code 2, and the message points to the help. */
export class UsageError extends CliError {
  constructor(message: string) {
    super(message, 2);
    this.name = 'UsageError';
  }
}
