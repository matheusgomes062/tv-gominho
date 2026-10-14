import { converterCommand } from './converter';
import { pendriveCommand } from './pendrive';
import type { Command } from './types';

/** Register new commands here. */
export const commands: Command[] = [converterCommand, pendriveCommand];
