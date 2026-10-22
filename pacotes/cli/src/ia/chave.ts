// Where `tv-gominho servir` keeps the Anthropic key typed in the app, and whether the AI is on: a data folder of the
// app on this computer, never the library (it goes to pendrives). The key file is readable by this user only where the
// system has such permissions (Linux, macOS); on Windows the folder under %LOCALAPPDATA% is already the user's own.

import { randomBytes } from 'node:crypto';
import { chmod, mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { apiKeyProblem } from '@tv-gominho/nucleo';

export const KEY_FILE = 'chave-anthropic.txt';
export const SETTINGS_FILE = 'ia.json';

/** The app's data folder: %LOCALAPPDATA%\TVGominho, ~/Library/Application Support/TVGominho or $XDG_CONFIG_HOME/tv-gominho. */
export function appDataDir(env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform, home = homedir()): string {
  const absolute = (value: string | undefined, paths: typeof path.posix) => (value && paths.isAbsolute(value) ? value : undefined);
  if (platform === 'win32') return path.win32.join(absolute(env.LOCALAPPDATA, path.win32) ?? path.win32.join(home, 'AppData', 'Local'), 'TVGominho');
  if (platform === 'darwin') return path.posix.join(home, 'Library', 'Application Support', 'TVGominho');
  return path.posix.join(absolute(env.XDG_CONFIG_HOME, path.posix) ?? path.posix.join(home, '.config'), 'tv-gominho');
}

/** True when `dir` is the library or inside it (compared without case on Windows and macOS). */
export function insideFolder(folder: string, dir: string): boolean {
  const fold = (value: string) => (process.platform === 'linux' ? path.resolve(value) : path.resolve(value).toLowerCase());
  const relative = path.relative(fold(folder), fold(dir));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

export interface KeyStore {
  readonly dir: string;
  /** The saved key, or undefined (none, or not a key). */
  readKey(): Promise<string | undefined>;
  saveKey(key: string): Promise<void>;
  /** Deletes the key file; false when there was none. */
  removeKey(): Promise<boolean>;
  /** Whether the person turned the AI on in the app. Off by default. */
  readEnabled(): Promise<boolean>;
  saveEnabled(on: boolean): Promise<void>;
}

export function createKeyStore(dir: string): KeyStore {
  const keyFile = path.join(dir, KEY_FILE);
  const settingsFile = path.join(dir, SETTINGS_FILE);

  /** Writes through a temporary file created with the final permissions, so the key is never readable by others. */
  async function save(file: string, text: string) {
    await mkdir(dir, { recursive: true, mode: 0o700 });
    const temp = path.join(dir, `.${path.basename(file)}-${randomBytes(6).toString('hex')}.tmp`);
    try {
      await writeFile(temp, text, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
      await rename(temp, file);
    } catch (error) {
      await unlink(temp).catch(() => {});
      throw error;
    }
    // The umask may have taken bits off at creation, never added any; this makes it exactly 0600 where it applies.
    await chmod(file, 0o600).catch(() => {});
  }

  return {
    dir,
    async readKey() {
      const text = await readFile(keyFile, 'utf8').catch(() => undefined);
      return text !== undefined && apiKeyProblem(text) === null ? text.trim() : undefined;
    },
    async saveKey(key) {
      if (apiKeyProblem(key) !== null) throw new Error('not a key');
      await save(keyFile, `${key.trim()}\n`);
    },
    async removeKey() {
      try {
        await unlink(keyFile);
        return true;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
        throw error;
      }
    },
    async readEnabled() {
      try {
        return (JSON.parse(await readFile(settingsFile, 'utf8')) as { ligada?: unknown }).ligada === true;
      } catch {
        return false;
      }
    },
    async saveEnabled(on) {
      await save(settingsFile, `${JSON.stringify({ ligada: on })}\n`);
    },
  };
}
