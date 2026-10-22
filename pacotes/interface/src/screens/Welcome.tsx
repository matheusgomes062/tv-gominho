import { scanLibrary, type Library, type LibraryWarning } from '@tv-gominho/nucleo';
import { useEffect, useRef, useState } from 'react';
import { Static } from '../components/Static';
import { focusFirst, useSpatialNav } from '../nav';
import { hasServerLibrary, openServerLibrary } from '../sources/server';
import {
  canRememberFolder,
  openFileList,
  openFolder,
  pickFolder,
  regainAccess,
  rememberFolder,
  rememberedFolder,
} from '../sources/folder';
import type { BrowserLibrary } from '../sources/types';
import { WarningList } from './Warnings';
import { Icon } from '../components/Icon';
import logo from '../assets/tv-gominho-logo.webp';

interface Props {
  onOpen(source: BrowserLibrary, library: Library): void;
}

type State =
  | { name: 'idle' }
  | { name: 'loading' }
  | { name: 'error'; message: string; warnings?: LibraryWarning[] };

/** The server's library opens by itself only on the first visit to this screen. */
let serverTried = false;

export function Welcome({ onOpen }: Props) {
  const [state, setState] = useState<State>({ name: 'idle' });
  const [saved, setSaved] = useState<FileSystemDirectoryHandle>();
  const [server, setServer] = useState(import.meta.env.DEV);
  const input = useRef<HTMLInputElement>(null);
  useSpatialNav();

  useEffect(() => {
    if (canRememberFolder) rememberedFolder().then(setSaved);
  }, []);

  useEffect(() => {
    if (state.name !== 'loading') focusFirst();
  }, [state.name, saved]);

  async function load(open: () => Promise<BrowserLibrary | null>) {
    setState({ name: 'loading' });
    try {
      const source = await open();
      if (!source) {
        setState({ name: 'idle' });
        return;
      }
      const library = await scanLibrary(source);
      if (library.shows.length === 0) {
        source.dispose();
        setState({
          name: 'error',
          message: `Nenhum programa com episódios em MP4 foi encontrado em "${source.name}".`,
          warnings: library.warnings,
        });
        return;
      }
      onOpen(source, library);
    } catch (error) {
      if ((error as DOMException).name === 'AbortError') setState({ name: 'idle' });
      else setState({ name: 'error', message: `Não foi possível abrir a pasta: ${(error as Error).message}` });
    }
  }

  const choose = () => {
    if (!canRememberFolder) {
      input.current?.click();
      return;
    }
    void load(async () => {
      const handle = await pickFolder();
      await rememberFolder(handle);
      return openFolder(handle);
    });
  };

  const reopen = (handle: FileSystemDirectoryHandle) =>
    load(async () => ((await regainAccess(handle)) ? openFolder(handle) : null));

  // Served by `tv-gominho servir`: open its library right away, once per page load (a TV Box or
  // Raspberry Pi turns on straight into the channel). Dev shortcut: ?exemplo does the same.
  useEffect(() => {
    if (import.meta.env.DEV) {
      if (new URLSearchParams(location.search).has('exemplo')) void load(openServerLibrary);
      return;
    }
    void hasServerLibrary().then((available) => {
      setServer(available);
      if (available && !serverTried) {
        serverTried = true;
        void load(openServerLibrary);
      }
    });
  }, []);

  return (
    <main className="welcome">
      <Static className="welcome-static" />
      <div className="welcome-card">
        <h1 className="welcome-logo">
          <img src={logo} alt="TV Gominho" width="960" height="640" />
        </h1>
        <p className="tagline">Os desenhos das manhãs da sua infância, como na TV.</p>

        {state.name === 'loading' ? (
          <p className="loading">Lendo a biblioteca…</p>
        ) : (
          <div className="welcome-actions">
            {saved && (
              <button data-nav className="button primary" onClick={() => reopen(saved)}>
                <Icon name="play" /> Abrir “{saved.name}”
              </button>
            )}
            <button data-nav className={`button ${saved ? '' : 'primary'}`} onClick={choose}>
              <Icon name="folder" /> {saved ? 'Escolher outra pasta' : 'Escolher biblioteca'}
            </button>
            {server && (
              <button data-nav className="button" onClick={() => load(openServerLibrary)}>
                {import.meta.env.DEV ? 'Usar biblioteca de exemplo' : 'Usar a biblioteca do servidor'}
              </button>
            )}
          </div>
        )}

        <input
          ref={(element) => {
            input.current = element;
            element?.setAttribute('webkitdirectory', '');
          }}
          type="file"
          hidden
          multiple
          onChange={(event) => {
            const files = event.currentTarget.files;
            if (files) void load(async () => openFileList(files));
            event.currentTarget.value = '';
          }}
        />

        {state.name === 'error' && (
          <div className="welcome-error" role="alert">
            <p>{state.message}</p>
            {state.warnings && state.warnings.length > 0 && <WarningList warnings={state.warnings} />}
          </div>
        )}

        <p className="hint">
          Escolha a pasta <code>biblioteca</code> (com <code>programas</code>, <code>vinhetas</code> e{' '}
          <code>grades</code>) ou a pasta que a contém, como a raiz de um pendrive. Os vídeos ficam no seu
          computador: nada é enviado para a internet.
        </p>
        {!canRememberFolder && (
          <p className="hint">No Chrome ou no Edge, a pasta fica lembrada para a próxima vez.</p>
        )}
      </div>
    </main>
  );
}
