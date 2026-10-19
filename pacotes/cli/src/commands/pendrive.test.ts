import { AUTO_SCHEDULE_ID, scanLibrary, type LibrarySource } from '@tv-gominho/nucleo';
import { describe, expect, it } from 'vitest';
import { chooseSchedule, pendriveCommand } from './pendrive';

const source = (files: Record<string, string>): LibrarySource => ({ files: Object.keys(files), readText: async (path) => files[path]! });
const GRADE = (name: string) => `nome: ${name}\ndata_inicio: 2026-01-05\nblocos:\n  - horario: "08:00"\n    itens:\n      - programa: turma\n`;
const SHOW = { 'programas/turma/programa.yaml': 'titulo: A Turma', 'programas/turma/episodios/001.mp4': '' };

describe('chooseSchedule', () => {
  it('takes the first schedule by default', async () => {
    const library = await scanLibrary(source({ ...SHOW, 'grades/1-manha.yaml': GRADE('Manhã'), 'grades/2-tarde.yaml': GRADE('Tarde') }));
    expect(chooseSchedule(library, undefined).name).toBe('Manhã');
  });

  it('finds a schedule by name or file name, ignoring case and accents', async () => {
    const library = await scanLibrary(source({ ...SHOW, 'grades/1-manha.yaml': GRADE('Manhã'), 'grades/2-tarde.yaml': GRADE('Tarde') }));
    expect(chooseSchedule(library, 'tarde').name).toBe('Tarde');
    expect(chooseSchedule(library, 'MANHA').name).toBe('Manhã');
    expect(chooseSchedule(library, '2-tarde').name).toBe('Tarde');
  });

  it('lists the schedules when the name does not exist', async () => {
    const library = await scanLibrary(source({ ...SHOW, 'grades/1-manha.yaml': GRADE('Manhã') }));
    expect(() => chooseSchedule(library, 'noite')).toThrow(/Não achei a grade "noite".*"Manhã"/);
  });

  it('uses the automatic channel when the library has shows but no schedules', async () => {
    const library = await scanLibrary(source(SHOW));
    expect(chooseSchedule(library, undefined).id).toBe(AUTO_SCHEDULE_ID);
    expect(() => chooseSchedule(library, 'qualquer')).toThrow(/Não achei a grade/);
  });

  it('refuses an empty library', async () => {
    const library = await scanLibrary(source({ 'vinhetas/aberturas/a.mp4': '' }));
    expect(() => chooseSchedule(library, undefined)).toThrow(/não há o que gerar/);
  });
});

describe('command line', () => {
  const run = (...args: string[]) => pendriveCommand.run(args, { signal: new AbortController().signal });

  it('needs the library and, unless simulating, the destination', async () => {
    await expect(run()).rejects.toThrow(/Informe a pasta da biblioteca/);
    await expect(run('./biblioteca')).rejects.toThrow(/--destino/);
  });

  it('refuses invalid values before doing any work, in pt-BR', async () => {
    await expect(run('./b', '-d', './x', '--dias', '0')).rejects.toThrow(/--dias precisa ser um número inteiro de 1 a 366/);
    await expect(run('./b', '-d', './x', '--a-partir-de', '12/10/2026')).rejects.toThrow(/AAAA-MM-DD/);
    await expect(run('./b', '-d', './x', '--a-partir-de', '2026-02-30')).rejects.toThrow(/AAAA-MM-DD/);
    await expect(run('./b', '-d', './x', '--preset', 'rapido')).rejects.toThrow(/--preset "rapido" não existe/);
    await expect(run('./b', '-d', './x', '--qualidade', '99')).rejects.toThrow(/--qualidade/);
    await expect(run('./b', '-d', './x', '--paralelo', '20')).rejects.toThrow(/--paralelo/);
    await expect(run('./b', '-d', './x', '--opcao-que-nao-existe')).rejects.toThrow(/Opção desconhecida/);
  });

  it('is registered with a pt-BR help that mentions every option', () => {
    for (const option of ['--destino', '--grade', '--dias', '--a-partir-de', '--sem-crt', '--crt', '--curvatura', '--sem-vinhetas', '--sem-comerciais', '--intervalo-a-cada', '--proporcao', '--copiar-biblioteca', '--qualidade', '--preset', '--simular', '--ffmpeg']) {
      expect(pendriveCommand.help).toContain(option);
    }
  });
});
