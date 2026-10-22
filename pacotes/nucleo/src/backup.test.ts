import { describe, expect, it } from 'vitest';
import { gradeBackupName, isGradeBackup } from './backup';
import { scanLibrary } from './library';
import { memorySource } from './test-helpers';

const GRADE = 'nome: Manhã\nblocos:\n  - horario: "08:00"\n    itens:\n      - programa: dbz\n';

describe('gradeBackupName', () => {
  it('keeps the file name and the date, and ends in .bak', () => {
    expect(gradeBackupName('manha', '2026-10-22', [])).toBe('manha.2026-10-22.yaml.bak');
    expect(gradeBackupName('manha.yaml', '2026-10-22', [])).toBe('manha.2026-10-22.yaml.bak');
    expect(gradeBackupName('biblioteca/grades/manha.yml', '2026-10-22', [])).toBe('manha.2026-10-22.yaml.bak');
  });

  it('adds a number when a backup of the same day exists, in any case and from any folder', () => {
    expect(gradeBackupName('manha', '2026-10-22', ['manha.2026-10-22.yaml.bak'])).toBe('manha.2026-10-22-2.yaml.bak');
    expect(gradeBackupName('manha', '2026-10-22', ['grades/Manha.2026-10-22.YAML.BAK', 'manha.2026-10-22-2.yaml.bak'])).toBe('manha.2026-10-22-3.yaml.bak');
    expect(gradeBackupName('manha', '2026-10-23', ['manha.2026-10-22.yaml.bak'])).toBe('manha.2026-10-23.yaml.bak');
  });

  it('is recognised as a backup, and a channel file is not', () => {
    expect(isGradeBackup(gradeBackupName('manha', '2026-10-22', []))).toBe(true);
    expect(isGradeBackup('grades/manha.yaml')).toBe(false);
    expect(isGradeBackup('grades/manha.yaml.bak')).toBe(true);
  });
});

describe('backups next to the channels', () => {
  it('are not loaded as channels, and do not raise warnings', async () => {
    const backup = gradeBackupName('manha', '2026-10-22', []);
    const library = await scanLibrary(
      memorySource({
        'programas/dbz/programa.yaml': 'titulo: DBZ',
        'programas/dbz/episodios/001.mp4': '',
        'grades/manha.yaml': GRADE,
        [`grades/${backup}`]: GRADE.replace('Manhã', 'Manhã antiga'),
      }),
    );
    expect(library.schedules.map((schedule) => schedule.id)).toEqual(['manha']);
    expect(library.schedules[0]!.name).toBe('Manhã');
    expect(library.warnings).toEqual([]);
  });
});
