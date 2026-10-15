import { describe, expect, it } from 'vitest';
import { buildReadme, settingsSummary, type ReadmeInput } from './readme';

const INPUT: ReadmeInput = {
  generatedAt: new Date(2026, 9, 14, 13, 5),
  scheduleName: 'TV Globinho (2003)',
  days: [
    {
      number: 1,
      date: '2026-10-12',
      seconds: 3 * 3600 + 120,
      parts: [
        { name: 'Dia 01 - Parte 1.mp4', bytes: 3_400_000_000, seconds: 7200 },
        { name: 'Dia 01 - Parte 2.mp4', bytes: 1_000_000_000, seconds: 3720 },
      ],
    },
    { number: 2, date: '2026-10-13', seconds: 3600, parts: [{ name: 'Dia 02 - Parte 1.mp4', bytes: 1_500_000_000, seconds: 3600 }] },
  ],
  crt: { intensity: 'medium', curvature: 50, scanlines: true },
  interstitials: true,
  commercials: true,
  adBreaks: { every: 8, ads: 3, afterEpisode: true, bumpers: true },
  aspect: '4:3',
  fps: 30,
  libraryCopied: false,
};

describe('buildReadme', () => {
  const text = buildReadme(INPUT);

  it('says how to play it on a TV, in pt-BR', () => {
    expect(text).toContain('COMO ASSISTIR NA TV');
    expect(text).toContain('pasta "ASSISTA AQUI"');
    expect(text).toContain('"Dia 01 - Parte 1.mp4"');
    expect(text).toContain('USB');
  });

  it('lists every day and part with duration and size', () => {
    expect(text).toContain('Dia 01 - segunda-feira, 12/10/2026 (3h02min)');
    expect(text).toContain('Dia 01 - Parte 1.mp4  (2h00min, 3,2 GB)');
    expect(text).toContain('Dia 02 - terça-feira, 13/10/2026 (1h00min)');
    expect(text).toContain('2 dias');
  });

  it('records the settings used', () => {
    expect(text).toContain('Efeito de TV de tubo (CRT): ligado, intensidade média, curvatura 50%');
    expect(text).toContain('Comerciais: sim (3 por intervalo, a cada 8 minutos de episódio');
    expect(text).toContain('1280x720, 30 quadros por segundo');
  });

  it('credits the tool, the licence and the lack of affiliation', () => {
    expect(text).toContain('Gerado pelo TV Chuvisco em 14/10/2026 13:05');
    expect(text).toContain('GPL-3.0');
    expect(text).toContain('nenhuma ligação com a TV Globo');
  });

  it('mentions the library copy only when it was made', () => {
    expect(text).not.toContain('TV BOX');
    const withCopy = buildReadme({ ...INPUT, libraryCopied: true });
    expect(withCopy).toContain('TV BOX COM O APLICATIVO');
    expect(withCopy).toContain('"biblioteca"');
  });

  it('uses Windows line breaks so any editor shows it properly', () => {
    expect(text.split('\r\n').length).toBeGreaterThan(30);
    expect(text.replace(/\r\n/g, '')).not.toContain('\n');
  });
});

describe('settingsSummary', () => {
  const base = { interstitials: true, commercials: true, adBreaks: INPUT.adBreaks, aspect: '4:3' as const, fps: 25, crt: INPUT.crt };

  it('describes each combination', () => {
    expect(settingsSummary({ ...base, crt: null })[0]).toBe('Efeito de TV de tubo (CRT): desligado');
    expect(settingsSummary({ ...base, crt: { intensity: 'strong', curvature: 0, scanlines: false } })[0]).toContain('forte, curvatura 0%, linhas de varredura não');
    expect(settingsSummary({ ...base, commercials: false })).toContain('Comerciais: não');
    expect(settingsSummary({ ...base, interstitials: false })).toContain('Vinhetas: não');
    expect(settingsSummary({ ...base, adBreaks: { every: 0, ads: 2, afterEpisode: false, bumpers: true } }).join('\n')).toContain('sem cortes no meio dos episódios');
    const bumperLine = 'Vinhetas de intervalo (entrando e voltando dos comerciais): ';
    expect(settingsSummary(base)).toContain(`${bumperLine}sim`);
    expect(settingsSummary({ ...base, adBreaks: { ...base.adBreaks, bumpers: false } })).toContain(`${bumperLine}não`);
    expect(settingsSummary({ ...base, interstitials: false })).toContain(`${bumperLine}não`);
    expect(settingsSummary({ ...base, aspect: 'stretch' }).join('\n')).toContain('esticada');
    expect(settingsSummary(base).join('\n')).toContain('25 quadros por segundo');
  });
});
