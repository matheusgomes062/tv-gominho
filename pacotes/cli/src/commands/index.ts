import { converterCommand } from './converter';
import type { Command } from './types';

/** Register new commands here (the `pendrive` command goes next to `converter`). */
export const commands: Command[] = [converterCommand];
