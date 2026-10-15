import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

// Guards for the bundled fonts (see docs/fontes-e-icones.md): every character of Brazilian Portuguese has to come from
// the font we asked for, and the pixel font whose accented capitals are broken must never draw library text.

const require = createRequire(import.meta.url);
const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
const css = read('./styles.css').replace(/\/\*[\s\S]*?\*\//g, ''); // comments out
const fontsTs = read('./fonts.ts');

const PT_BR = 'ÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑáàâãäéèêëíìîïóòôõöúùûüçñ«»“”‘’–—…•°ºª';

/** Does a fontsource `unicode-range` string ("U+0000-00FF,U+0131") cover the code point? */
function covers(range: string, codePoint: number): boolean {
  return range.split(',').some((part) => {
    const [from, to = from] = part.replace('U+', '').split('-').map((hex) => parseInt(hex, 16));
    return codePoint >= from! && codePoint <= to!;
  });
}

describe('bundled font subsets', () => {
  const imported = [...fontsTs.matchAll(/^import '@fontsource\/([\w-]+)\/([\w-]+)\.css';/gm)].map((m) => ({ id: m[1]!, file: m[2]! }));

  it('imports every font family used by the themes', () => {
    expect([...new Set(imported.map((f) => f.id))].sort()).toEqual(['figtree', 'jersey-15', 'press-start-2p', 'share-tech-mono', 'vt323']);
  });

  for (const { id, file } of imported) {
    it(`${id} ${file}: the imported subset covers every pt-BR character`, () => {
      const subset = file.split('-')[0]!; // "latin-400" -> "latin"
      const ranges = JSON.parse(readFileSync(require.resolve(`@fontsource/${id}/unicode.json`), 'utf8')) as Record<string, string>;
      const missing = [...PT_BR].filter((ch) => !covers(ranges[subset]!, ch.codePointAt(0)!));
      expect(missing.join('')).toBe('');
    });
  }
});

describe('Press Start 2P (8x8 pixel grid: accented capitals read as lowercase)', () => {
  /** The declaration blocks of the stylesheet: [selector, body]. */
  const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => [m[1]!.trim().replace(/\s+/g, ' '), m[2]!] as const);

  it('is only named in the TV antiga skin (for --ff-osd) and in the fixed ASCII sample of its theme card', () => {
    const uses = rules.filter(([, body]) => /Press Start 2P/.test(body));
    expect(uses.map(([selector]) => selector)).toEqual([":root, :root[data-skin='classic']", '.preview-classic']);
    expect(uses[0]![1]).toMatch(/--ff-osd: 'Press Start 2P'/);
  });

  it('--ff-osd (digits only) is used just by the channel number and the clock', () => {
    const users = rules.filter(([, body]) => /font-family:\s*var\(--ff-osd\)/.test(body)).map(([selector]) => selector);
    expect(users.sort()).toEqual(['.osd-channel', '.osd-clock']);
  });

  it('names and titles (library text) use --ff-osd-title, defined by every skin', () => {
    for (const selector of ['.osd-name', '.osd-info strong']) {
      const rule = rules.find(([sel]) => sel === selector);
      expect(rule, selector).toBeDefined();
      expect(rule![1], selector).toMatch(/font-family:\s*var\(--ff-osd-title\)/);
    }
    const skins = rules.filter(([, body]) => /--ff-osd:/.test(body));
    expect(skins).toHaveLength(3); // classic, vhs, modern
    for (const [selector, body] of skins) expect(body, selector).toMatch(/--ff-osd-title:/);
  });
});
