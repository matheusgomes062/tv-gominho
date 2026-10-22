import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { OSD_FONTS, WATERMARK, watermarkRect, wrapWords } from './osd-painter';

// The painter draws the OSD into the CRT tube with its own copy of the skins' fonts: keep it in step with styles.css
// and keep the Press Start 2P rule (digits and ASCII only: its accented capitals read as lowercase).

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
const css = read('../styles.css').replace(/\/\*[\s\S]*?\*\//g, '');
const fontsTs = read('../fonts.ts');

/** The first family of a skin's custom property, e.g. `--ff-osd-title` of the `vhs` skin. */
function skinFont(skin: string, property: string): string | undefined {
  const selector = skin === 'classic' ? /:root,\s*:root\[data-skin='classic'\]\s*\{([^}]*)\}/ : new RegExp(String.raw`:root\[data-skin='${skin}'\]\s*\{([^}]*)\}`);
  const body = css.match(selector)?.[1] ?? '';
  const value = body.match(new RegExp(String.raw`${property}:\s*([^;]+);`))?.[1]?.trim();
  if (value === 'var(--font-sans)') return 'Figtree';
  return value?.split(',')[0]?.replace(/['"]/g, '').trim();
}

describe('OSD painter fonts', () => {
  for (const skin of ['classic', 'vhs', 'modern'] as const) {
    it(`${skin}: the painter uses the same fonts as the stylesheet`, () => {
      expect(OSD_FONTS[skin].number).toBe(skinFont(skin, '--ff-osd'));
      expect(OSD_FONTS[skin].title).toBe(skinFont(skin, '--ff-osd-title'));
      expect(OSD_FONTS[skin].text).toBe(skinFont(skin, '--ff-osd-text'));
    });
  }

  it('Press Start 2P only draws the digit roles, never library text (titles, names)', () => {
    for (const fonts of Object.values(OSD_FONTS)) {
      expect(fonts.title).not.toBe('Press Start 2P');
      expect(fonts.text).not.toBe('Press Start 2P');
    }
    expect(OSD_FONTS.classic.number).toBe('Press Start 2P');
  });

  it('every font it draws with is bundled', () => {
    const ids = new Set([...fontsTs.matchAll(/^import '@fontsource\/([\w-]+)\//gm)].map((m) => m[1]));
    const slug = (name: string) => name.toLowerCase().replace(/\s+/g, '-');
    for (const fonts of Object.values(OSD_FONTS)) for (const name of Object.values(fonts)) expect(ids.has(slug(name)), name).toBe(true);
  });
});

describe('wrapWords', () => {
  const measure = (text: string) => text.length * 10;
  it('breaks greedily at spaces', () => {
    expect(wrapWords(measure, 'a bb ccc dddd', 80)).toEqual(['a bb ccc', 'dddd']);
  });
  it('keeps a word wider than the box on its own line', () => {
    expect(wrapWords(measure, 'x extraordinarily y', 50)).toEqual(['x', 'extraordinarily', 'y']);
  });
  it('returns one empty line for empty text', () => {
    expect(wrapWords(measure, '', 50)).toEqual(['']);
  });
});

describe('watermarkRect', () => {
  it('puts a wide image in the top right corner, 11% of the tube wide, keeping its shape', () => {
    const box = watermarkRect(1000, 750, 400, 100);
    expect(box.width).toBeCloseTo(110);
    expect(box.height).toBeCloseTo(27.5);
    expect(box.x + box.width).toBeCloseTo(940);
    expect(box.y).toBeCloseTo(45);
  });

  it('shrinks a tall image to 20% of the tube height', () => {
    const box = watermarkRect(1000, 750, 100, 400);
    expect(box.height).toBeCloseTo(150);
    expect(box.width).toBeCloseTo(37.5);
    expect(box.x + box.width).toBeCloseTo(940);
  });

  it('is the same box the stylesheet gives the plain screen', () => {
    const rule = css.match(/\.tv-watermark\s*\{([^}]*)\}/)?.[1] ?? '';
    const percent = (property: string) => Number(rule.match(new RegExp(String.raw`${property}:\s*([\d.]+)%`))?.[1]) / 100;
    expect(percent('width')).toBe(WATERMARK.maxWidth);
    expect(percent('max-height')).toBe(WATERMARK.maxHeight);
    expect(percent('top')).toBe(WATERMARK.margin);
    expect(percent('right')).toBe(WATERMARK.margin);
    expect(Number(rule.match(/opacity:\s*([\d.]+)/)?.[1])).toBe(WATERMARK.opacity);
  });
});
