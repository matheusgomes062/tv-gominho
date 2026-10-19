import { parseArgs, type ParseArgsConfig } from 'node:util';
import { UsageError } from './errors';

type OptionsConfig = NonNullable<ParseArgsConfig['options']>;

/** Options every command that uses ffmpeg accepts. */
export const ffmpegOptions = {
  ffmpeg: { type: 'string' },
} as const satisfies OptionsConfig;

export const helpOptions = {
  ajuda: { type: 'boolean', short: 'h' },
} as const satisfies OptionsConfig;

/** parseArgs with strict checking and pt-BR error messages. */
export function parseOptions<const T extends OptionsConfig>(argv: string[], options: T) {
  try {
    return parseArgs({ args: argv, options, allowPositionals: true, strict: true });
  } catch (error) {
    const { code, message } = error as NodeJS.ErrnoException;
    // parseArgs messages quote the option first: "Unknown option '--x'", "Option '--ffmpeg <value>' argument missing".
    const flag = /'(-[^' ]+)/.exec(message)?.[1] ?? 'desconhecida';
    if (code === 'ERR_PARSE_ARGS_UNKNOWN_OPTION') throw new UsageError(`Opção desconhecida: ${flag}. Veja "tv-gominho ajuda".`);
    if (code === 'ERR_PARSE_ARGS_INVALID_OPTION_VALUE') {
      throw new UsageError(/missing/.test(message) ? `A opção ${flag} precisa de um valor.` : `A opção ${flag} não aceita um valor.`);
    }
    throw new UsageError('Argumentos inválidos. Veja "tv-gominho ajuda".');
  }
}

/** Parses an integer option within [min, max]; undefined when the flag was not given. */
export function intOption(flag: string, value: string | undefined, min: number, max: number): number | undefined {
  if (value === undefined) return undefined;
  const number = Number(value);
  if (!Number.isInteger(number) || number < min || number > max) {
    throw new UsageError(`${flag} precisa ser um número inteiro de ${min} a ${max} (recebi "${value}").`);
  }
  return number;
}
