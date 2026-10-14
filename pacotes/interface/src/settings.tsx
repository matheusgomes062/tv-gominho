import {
  mergeSettings,
  sanitizeSettings,
  touchesTheme,
  type AspectMode,
  type Library,
  type PartialSettings,
  type Settings,
} from '@tv-chuvisco/nucleo';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

// Effective settings = DEFAULT_SETTINGS < the library's configuracoes.yaml
// (already merged into `library.settings`) < the user's own choices, which are
// saved in the browser per library name.

const STORAGE_PREFIX = 'tv-chuvisco.config.';

export interface SettingsApi {
  /** What the app should obey right now. */
  settings: Settings;
  /** The library's own defaults (DEFAULT_SETTINGS + configuracoes.yaml). */
  libraryDefaults: Settings;
  /** What configuracoes.yaml sets, to tell "from the library" from "default". */
  fromLibrary: PartialSettings;
  /** Only what the user changed in the menu. */
  overrides: PartialSettings;
  /**
   * Saves the user's choice for the given fields (crt and adBreaks can be partial). Changing something a
   * theme preset covers (CRT, aspect, snow, skin) without naming a theme switches the theme to 'custom'.
   */
  update(partial: PartialSettings): void;
  /** Forgets the user's choices: back to the library's defaults. */
  reset(): void;
}

const SettingsContext = createContext<SettingsApi | null>(null);

export function useSettings(): SettingsApi {
  const api = useContext(SettingsContext);
  if (!api) throw new Error('useSettings() must be used inside <SettingsProvider>.');
  return api;
}

/** CSS class for the `proporcao` setting, put on the screen container (see .tv-screen in styles.css). */
export function aspectClass(aspect: AspectMode): string {
  return `aspect-${aspect === '4:3' ? '4-3' : aspect}`;
}

export function loadOverrides(libraryName: string): PartialSettings {
  try {
    const text = localStorage.getItem(STORAGE_PREFIX + libraryName);
    return text ? sanitizeSettings(JSON.parse(text)) : {};
  } catch {
    return {};
  }
}

function saveOverrides(libraryName: string, overrides: PartialSettings) {
  try {
    if (Object.keys(overrides).length === 0) localStorage.removeItem(STORAGE_PREFIX + libraryName);
    else localStorage.setItem(STORAGE_PREFIX + libraryName, JSON.stringify(overrides));
  } catch {
    // Storage blocked: the choices just last until the page is closed.
  }
}

/** Layers two partials (crt is merged field by field). */
function layer(base: PartialSettings, top: PartialSettings): PartialSettings {
  const result: PartialSettings = { ...base, ...top };
  if (base.crt || top.crt) result.crt = { ...base.crt, ...top.crt };
  if (base.adBreaks || top.adBreaks) result.adBreaks = { ...base.adBreaks, ...top.adBreaks };
  return result;
}

/** Drops the choices that equal what the library already gives, so "changed" really means changed. */
function prune(overrides: PartialSettings, libraryDefaults: Settings): PartialSettings {
  const { crt, adBreaks, ...rest } = overrides;
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(rest)) {
    if (value !== undefined && value !== libraryDefaults[key as keyof Omit<Settings, 'crt' | 'adBreaks'>]) result[key] = value;
  }
  const crtResult: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(crt ?? {})) {
    if (value !== undefined && value !== libraryDefaults.crt[key as keyof Settings['crt']]) crtResult[key] = value;
  }
  if (Object.keys(crtResult).length > 0) result.crt = crtResult;
  const adResult: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(adBreaks ?? {})) {
    if (value !== undefined && value !== libraryDefaults.adBreaks[key as keyof Settings['adBreaks']]) adResult[key] = value;
  }
  if (Object.keys(adResult).length > 0) result.adBreaks = adResult;
  return result as PartialSettings;
}

export function SettingsProvider({
  libraryName,
  library,
  children,
}: {
  libraryName: string;
  library: Library;
  children: ReactNode;
}) {
  const libraryDefaults = library.settings;
  const [overrides, setOverrides] = useState(() => prune(loadOverrides(libraryName), libraryDefaults));

  useEffect(() => saveOverrides(libraryName, overrides), [libraryName, overrides]);

  const update = useCallback(
    (partial: PartialSettings) =>
      setOverrides((current) => {
        let choice = partial;
        if (partial.theme === undefined && touchesTheme(partial) && mergeSettings(libraryDefaults, current).theme !== 'custom') {
          choice = { ...partial, theme: 'custom' };
        }
        return prune(layer(current, choice), libraryDefaults);
      }),
    [libraryDefaults],
  );
  const reset = useCallback(() => setOverrides({}), []);

  const settings = useMemo(() => mergeSettings(libraryDefaults, overrides), [libraryDefaults, overrides]);

  // The theme's skin also tints the overlays and the library (see :root[data-skin] in styles.css).
  useEffect(() => {
    document.documentElement.dataset.skin = settings.osdSkin;
    return () => {
      delete document.documentElement.dataset.skin;
    };
  }, [settings.osdSkin]);

  const api = useMemo<SettingsApi>(
    () => ({
      settings,
      libraryDefaults,
      fromLibrary: library.settingsFile,
      overrides,
      update,
      reset,
    }),
    [settings, libraryDefaults, library.settingsFile, overrides, update, reset],
  );
  return <SettingsContext.Provider value={api}>{children}</SettingsContext.Provider>;
}
