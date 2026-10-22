import { describe, expect, it } from 'vitest';
import { scanLibrary } from './library';
import { DEFAULT_AD_BREAKS, DEFAULT_CURVATURE, DEFAULT_SETTINGS, findChannelIndex, mergeSettings, parseSettings, sanitizeSettings } from './settings';
import { memorySource } from './test-helpers';
import type { LibraryWarning, Schedule } from './types';

function parse(text: string) {
  const warnings: LibraryWarning[] = [];
  const settings = parseSettings('configuracoes.yaml', text, warnings);
  return { settings, warnings };
}

describe('parseSettings', () => {
  it('returns nothing for an empty file', () => {
    expect(parse('')).toEqual({ settings: {}, warnings: [] });
    expect(parse('# só comentários\n')).toEqual({ settings: {}, warnings: [] });
  });

  it('reads only what the file sets, so it can be merged over the defaults', () => {
    const { settings, warnings } = parse('horario: real\ncomerciais: false\n');
    expect(warnings).toEqual([]);
    expect(settings).toEqual({ schedule: 'real', commercials: false });
    expect(mergeSettings(DEFAULT_SETTINGS, settings)).toEqual({
      ...DEFAULT_SETTINGS,
      schedule: 'real',
      commercials: false,
    });
  });

  it('reads every option with its pt-BR values', () => {
    const { settings, warnings } = parse(`
modo_inicial: biblioteca
canal_inicial: TV Gominho
canais_por_programa: não
horario: do_inicio
crt:
  ligado: sim
  intensidade: forte
  curvatura: 35
  linhas: true
chuvisco_troca_canal: false
proporcao: esticar
vinhetas: não
comerciais: sim
relogio_na_tela: sim
`);
    expect(warnings).toEqual([]);
    expect(settings).toEqual({
      startMode: 'library',
      startChannel: 'TV Gominho',
      channelsPerShow: false,
      schedule: 'fromStart',
      crt: { enabled: true, intensity: 'strong', curvature: 35, scanlines: true },
      channelChangeStatic: false,
      aspect: 'stretch',
      interstitials: false,
      commercials: true,
      clock: true,
    });
  });

  it('accepts 4:3 and values with accents or capitals', () => {
    expect(parse('proporcao: 4:3').settings).toEqual({ aspect: '4:3' });
    expect(parse('crt:\n  intensidade: Média').settings).toEqual({ crt: { intensity: 'medium' } });
    expect(parse('relogio_na_tela: SIM').settings).toEqual({ clock: true });
  });

  it('merges a partial crt block over the default crt', () => {
    const { settings } = parse('crt:\n  intensidade: suave\n');
    expect(mergeSettings(DEFAULT_SETTINGS, settings).crt).toEqual({
      enabled: true,
      intensity: 'soft',
      curvature: 50,
      scanlines: true,
    });
  });

  it('reads curvatura as a number, a percentage, or the old sim/não', () => {
    const curvature = (text: string) => parse(`crt:
  curvatura: ${text}
`);
    expect(curvature('0').settings).toEqual({ crt: { curvature: 0 } });
    expect(curvature('72').settings).toEqual({ crt: { curvature: 72 } });
    expect(curvature('"50%"').settings).toEqual({ crt: { curvature: 50 } });
    expect(curvature('30%').settings).toEqual({ crt: { curvature: 30 } });
    expect(curvature('12.6').settings).toEqual({ crt: { curvature: 13 } });
    expect(curvature('sim').settings).toEqual({ crt: { curvature: DEFAULT_CURVATURE } });
    expect(curvature('não').settings).toEqual({ crt: { curvature: 0 } });
    expect(curvature('false').settings).toEqual({ crt: { curvature: 0 } });
    expect(curvature('100').warnings).toEqual([]);
  });

  it('clamps curvatura outside 0-100 with a warning, and ignores non-numbers', () => {
    const high = parse(`crt:
  curvatura: 250
`);
    expect(high.settings).toEqual({ crt: { curvature: 100 } });
    expect(high.warnings[0]!.message).toContain('entre 0 e 100');
    const low = parse(`crt:
  curvatura: -5
`);
    expect(low.settings).toEqual({ crt: { curvature: 0 } });
    expect(low.warnings).toHaveLength(1);
    const bad = parse(`crt:
  curvatura: bastante
`);
    expect(bad.settings).toEqual({});
    expect(bad.warnings[0]!.message).toContain('"crt.curvatura" deve ser um número de 0 a 100');
  });

  it('reads the commercial breaks block (intervalos)', () => {
    const { settings, warnings } = parse(`intervalos:
  a_cada: 12
  comerciais: 4
  apos_episodio: não
  vinhetas: não
`);
    expect(warnings).toEqual([]);
    expect(settings).toEqual({ adBreaks: { every: 12, ads: 4, afterEpisode: false, bumpers: false } });
    expect(mergeSettings(DEFAULT_SETTINGS, settings).adBreaks).toEqual({ every: 12, ads: 4, afterEpisode: false, bumpers: false });
    expect(DEFAULT_SETTINGS.adBreaks).toEqual({ every: 8, ads: 3, afterEpisode: true, bumpers: true });
  });

  it('reads intervalos.vinhetas as sim/não and warns about anything else', () => {
    expect(parse('intervalos:\n  vinhetas: sim\n').settings).toEqual({ adBreaks: { bumpers: true } });
    expect(parse('intervalos:\n  vinhetas: Não\n').settings).toEqual({ adBreaks: { bumpers: false } });
    const bad = parse('intervalos:\n  vinhetas: talvez\n');
    expect(bad.settings).toEqual({});
    expect(bad.warnings[0]!.message).toContain('"intervalos.vinhetas" deve ser sim ou não');
    // The top-level `vinhetas` is the global switch and does not touch it.
    expect(parse('vinhetas: não\n').settings).toEqual({ interstitials: false });
  });

  it('merges a partial intervalos block over the default one', () => {
    const { settings } = parse(`intervalos:
  a_cada: 0
`);
    expect(settings).toEqual({ adBreaks: { every: 0 } });
    expect(mergeSettings(DEFAULT_SETTINGS, settings).adBreaks).toEqual({ ...DEFAULT_AD_BREAKS, every: 0 });
  });

  it('clamps intervalos numbers with a warning and ignores bad ones', () => {
    const high = parse(`intervalos:
  a_cada: 90
  comerciais: 50
`);
    expect(high.settings).toEqual({ adBreaks: { every: 30, ads: 10 } });
    expect(high.warnings.map((w) => w.message)).toEqual([
      expect.stringContaining('"intervalos.a_cada" deve ficar entre 0 e 30'),
      expect.stringContaining('"intervalos.comerciais" deve ficar entre 1 e 10'),
    ]);
    const low = parse(`intervalos:
  a_cada: -3
  comerciais: 0
`);
    expect(low.settings).toEqual({ adBreaks: { every: 0, ads: 1 } });
    expect(low.warnings).toHaveLength(2);
    const bad = parse(`intervalos:
  a_cada: muito
  comerciais: [1]
  apos_episodio: talvez
  foo: 1
`);
    expect(bad.settings).toEqual({});
    expect(bad.warnings.map((w) => w.message)).toEqual([
      expect.stringContaining('"intervalos.a_cada" deve ser um número de 0 a 30'),
      expect.stringContaining('"intervalos.comerciais" deve ser um número de 1 a 10'),
      expect.stringContaining('"intervalos.apos_episodio" deve ser sim ou não'),
      expect.stringContaining('Opção desconhecida: "intervalos.foo"'),
    ]);
    expect(parse('intervalos: 5').warnings[0]!.message).toContain('"intervalos" deve ter opções por baixo');
    expect(parse(`intervalos:
  a_cada: "8 min"
`).settings).toEqual({ adBreaks: { every: 8 } });
  });

  it('warns about bad values and unknown options, keeping the default', () => {
    const { settings, warnings } = parse(`
horario: sempre
comerciais: talvez
crt:
  intensidade: 11
  brilho: sim
foo: bar
canal_inicial: 3
`);
    expect(settings).toEqual({});
    expect(warnings.map((w) => w.message)).toEqual([
      expect.stringContaining('"horario" deve ser continuo, real, do_inicio'),
      expect.stringContaining('"comerciais" deve ser sim ou não'),
      expect.stringContaining('"crt.intensidade" deve ser suave, media, forte'),
      expect.stringContaining('Opção desconhecida: "crt.brilho"'),
      expect.stringContaining('Opção desconhecida: "foo"'),
      expect.stringContaining('"canal_inicial"'),
    ]);
    expect(warnings.every((w) => w.path === 'configuracoes.yaml')).toBe(true);
  });

  it('says idioma is not supported yet and ignores it', () => {
    const { settings, warnings } = parse('idioma: en\n');
    expect(settings).toEqual({});
    expect(warnings).toEqual([expect.objectContaining({ message: expect.stringContaining('"idioma" ainda não é suportada') })]);
  });

  describe('marca_dagua', () => {
    it('reads a path relative to the library, with forward slashes and no leading "./"', () => {
      expect(parse('marca_dagua: marca.png\n')).toEqual({ settings: { watermark: 'marca.png' }, warnings: [] });
      expect(parse('marca_dagua: ./imagens\\marca.WebP\n').settings).toEqual({ watermark: 'imagens/marca.WebP' });
      expect(parse('marca_dagua: "  marca.jpg "\n').settings).toEqual({ watermark: 'marca.jpg' });
    });

    it('has no watermark by default and when the value is empty', () => {
      expect(DEFAULT_SETTINGS.watermark).toBeNull();
      expect(parse('marca_dagua:\n')).toEqual({ settings: {}, warnings: [] });
    });

    it('refuses absolute paths, "..", and values that are not an image path, with a warning', () => {
      for (const value of ['/etc/marca.png', 'C:\\marca.png', 'c:marca.png', '../marca.png', 'a/../../marca.png', 'a//marca.png', 'marca.gif', 'marca', '42', 'true', '[marca.png]']) {
        const { settings, warnings } = parse(`marca_dagua: ${JSON.stringify(value)}\n`);
        expect(settings, value).toEqual({});
        expect(warnings, value).toHaveLength(1);
        expect(warnings[0]!.message, value).toContain('"marca_dagua"');
      }
    });
  });

  it('warns about broken YAML and non-mapping files', () => {
    expect(parse('horario: [real').warnings[0]!.message).toContain('Erro de sintaxe');
    expect(parse('- a\n- b\n').warnings).toHaveLength(1);
  });
});

describe('mergeSettings', () => {
  it('layers on top without mutating the base', () => {
    const user = mergeSettings(DEFAULT_SETTINGS, { crt: { enabled: false }, clock: true });
    expect(user.crt).toEqual({ ...DEFAULT_SETTINGS.crt, enabled: false });
    expect(user.clock).toBe(true);
    expect(DEFAULT_SETTINGS.clock).toBe(false);
    expect(DEFAULT_SETTINGS.crt.enabled).toBe(true);
  });

  it('ignores undefined fields', () => {
    expect(mergeSettings(DEFAULT_SETTINGS, { clock: undefined, crt: { scanlines: undefined } })).toEqual(DEFAULT_SETTINGS);
  });
});

describe('sanitizeSettings', () => {
  it('migrates the old boolean curvature and clamps numbers', () => {
    const curvature = (value: unknown) => sanitizeSettings({ crt: { curvature: value } });
    expect(curvature(true)).toEqual({ crt: { curvature: DEFAULT_CURVATURE } });
    expect(curvature(false)).toEqual({ crt: { curvature: 0 } });
    expect(curvature(30)).toEqual({ crt: { curvature: 30 } });
    expect(curvature(400)).toEqual({ crt: { curvature: 100 } });
    expect(curvature(-1)).toEqual({ crt: { curvature: 0 } });
    expect(curvature('50')).toEqual({ crt: {} });
  });

  it('sanitizes the stored commercial-break choices', () => {
    expect(sanitizeSettings({ adBreaks: { every: 2, ads: 99, afterEpisode: false, bumpers: false, extra: 1 } })).toEqual({
      adBreaks: { every: 2, ads: 10, afterEpisode: false, bumpers: false },
    });
    expect(sanitizeSettings({ adBreaks: { bumpers: 'sim' } })).toEqual({ adBreaks: {} });
    expect(sanitizeSettings({ adBreaks: { every: 'x', ads: -4 } })).toEqual({ adBreaks: { ads: 1 } });
    expect(sanitizeSettings({ adBreaks: 3 })).toEqual({});
  });

  it('keeps valid fields and drops the rest', () => {
    expect(
      sanitizeSettings({
        aspect: 'stretch',
        schedule: 'sempre',
        clock: 'yes',
        startChannel: null,
        crt: { enabled: false, intensity: 'loud', extra: 1 },
        other: true,
      }),
    ).toEqual({ aspect: 'stretch', startChannel: null, crt: { enabled: false } });
    expect(sanitizeSettings('x')).toEqual({});
    expect(sanitizeSettings(null)).toEqual({});
  });
});

describe('findChannelIndex', () => {
  const channels = [
    { id: 'manha', name: 'TV Gominho' },
    { id: '__programa:bob', name: 'Bob Esponja' },
  ] as Schedule[];

  it('matches name or id, ignoring case and accents', () => {
    expect(findChannelIndex(channels, 'tv gominho')).toBe(0);
    expect(findChannelIndex(channels, 'Manhã')).toBe(0);
    expect(findChannelIndex(channels, 'bob esponja')).toBe(1);
    expect(findChannelIndex(channels, 'nada')).toBe(-1);
  });
});

describe('scanLibrary settings', () => {
  const files = { 'programas/bob/episodios/001.mp4': '', 'programas/bob/programa.yaml': 'titulo: Bob' };

  it('uses the defaults when there is no configuracoes.yaml', async () => {
    const library = await scanLibrary(memorySource(files));
    expect(library.settings).toEqual(DEFAULT_SETTINGS);
    expect(library.settingsFile).toEqual({});
  });

  it('reads configuracoes.yaml, also inside a nested biblioteca/ folder', async () => {
    const text = 'horario: real\ncrt:\n  ligado: não\nhorario2: x\n';
    for (const prefix of ['', 'biblioteca/']) {
      const library = await scanLibrary(
        memorySource(Object.fromEntries([...Object.entries(files), ['configuracoes.yaml', text]].map(([k, v]) => [prefix + k, v]))),
      );
      expect(library.settings.schedule).toBe('real');
      expect(library.settings.crt).toEqual({ ...DEFAULT_SETTINGS.crt, enabled: false });
      expect(library.settingsFile).toEqual({ schedule: 'real', crt: { enabled: false } });
      expect(library.warnings.map((w) => w.message)).toEqual([expect.stringContaining('"horario2"')]);
      expect(library.warnings[0]!.path).toBe(`${prefix}configuracoes.yaml`);
    }
  });

  it('resolves marca_dagua against the library root, ignoring case', async () => {
    for (const prefix of ['', 'biblioteca/']) {
      const library = await scanLibrary(
        memorySource(Object.fromEntries([...Object.entries(files), ['configuracoes.yaml', 'marca_dagua: Imagens/Marca.png\n'], ['imagens/marca.PNG', '']].map(([k, v]) => [prefix + k, v]))),
      );
      expect(library.settings.watermark).toBe(`${prefix}imagens/marca.PNG`);
      expect(library.settingsFile).toEqual({ watermark: `${prefix}imagens/marca.PNG` });
      expect(library.warnings).toEqual([]);
    }
  });

  it('warns and ignores a marca_dagua whose file is missing', async () => {
    const library = await scanLibrary(memorySource({ ...files, 'configuracoes.yaml': 'marca_dagua: marca.png\nhorario: real\n' }));
    expect(library.settings.watermark).toBeNull();
    expect(library.settings.schedule).toBe('real');
    expect(library.warnings).toEqual([{ path: 'configuracoes.yaml', message: expect.stringContaining('"marca.png" não foi encontrada') }]);
  });
});
