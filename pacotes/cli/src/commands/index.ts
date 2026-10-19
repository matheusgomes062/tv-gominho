import { converterCommand } from './converter';
import { gradeCommand } from './grade';
import { pendriveCommand } from './pendrive';
import { servirCommand } from './servir';
import { verificarCommand } from './verificar';
import type { Command } from './types';

/** Register new commands here. */
export const commands: Command[] = [converterCommand, gradeCommand, pendriveCommand, verificarCommand, servirCommand];
