import { createAutoSchedule, createShowChannels, findChannelIndex, type Library } from '@tv-chuvisco/nucleo';
import { useCallback, useMemo, useRef, useState } from 'react';
import { Durations } from './media';
import { LibraryMode } from './screens/LibraryMode';
import { Menu } from './screens/Menu';
import { Player } from './screens/Player';
import { SettingsScreen } from './screens/Settings';
import { ShowPage } from './screens/ShowPage';
import { TvMode } from './screens/TvMode';
import { Warnings } from './screens/Warnings';
import { Welcome } from './screens/Welcome';
import { SettingsProvider, useSettings } from './settings';
import type { BrowserLibrary } from './sources/types';

interface Session {
  /** Changes with every opened folder, so the screens below start fresh. */
  id: number;
  source: BrowserLibrary;
  library: Library;
  durations: Durations;
}

type View =
  | { name: 'tv' }
  | { name: 'menu' }
  | { name: 'settings' }
  | { name: 'warnings' }
  | { name: 'library'; focusShow?: string }
  | { name: 'show'; showId: string; focusEpisode?: number }
  | { name: 'player'; showId: string; index: number };

const CHANNEL_KEY = 'tv-chuvisco.canal';

function savedChannel(): number | undefined {
  try {
    const saved = localStorage.getItem(CHANNEL_KEY);
    return saved === null ? undefined : Number(saved) || 0;
  } catch {
    return undefined;
  }
}

export function App() {
  const [session, setSession] = useState<Session | null>(null);
  const nextId = useRef(0);

  const open = useCallback((source: BrowserLibrary, library: Library) => {
    setSession({ id: nextId.current++, source, library, durations: new Durations(source) });
  }, []);

  if (!session) return <Welcome onOpen={open} />;
  return (
    <SettingsProvider key={session.id} libraryName={session.source.name} library={session.library}>
      <Main
        session={session}
        onChangeFolder={() => {
          session.source.dispose();
          setSession(null);
        }}
      />
    </SettingsProvider>
  );
}

function Main({ session, onChangeFolder }: { session: Session; onChangeFolder(): void }) {
  const { source, library, durations } = session;
  const { settings } = useSettings();

  const base = useMemo(() => {
    const auto = createAutoSchedule(library);
    return library.schedules.length > 0 ? library.schedules : auto ? [auto] : [];
  }, [library]);
  const channels = useMemo(
    () => (settings.channelsPerShow ? [...base, ...createShowChannels(library)] : base),
    [base, library, settings.channelsPerShow],
  );

  const [view, setView] = useState<View>(settings.startMode === 'library' ? { name: 'library' } : { name: 'tv' });
  // A channel saved by the last visit wins over `canal_inicial`, which only applies the first time.
  const [channel, setChannelState] = useState(() => {
    const saved = savedChannel();
    if (saved !== undefined) return saved;
    const start = settings.startChannel === null ? -1 : findChannelIndex(channels, settings.startChannel);
    return Math.max(0, start);
  });

  const setChannel = useCallback((index: number) => {
    setChannelState(index);
    try {
      localStorage.setItem(CHANNEL_KEY, String(index));
    } catch {
      // Storage blocked: the channel just isn't remembered.
    }
  }, []);

  const safeChannel = channel < channels.length ? channel : 0;

  const toTv = useCallback(() => setView({ name: 'tv' }), []);
  const toMenu = useCallback(() => setView({ name: 'menu' }), []);
  const toLibrary = useCallback((focusShow?: string) => setView({ name: 'library', focusShow }), []);

  const show = useMemo(() => {
    if (!('showId' in view)) return undefined;
    return library.shows.find((s) => s.id === view.showId);
  }, [library, view]);

  switch (view.name) {
    case 'tv':
      return (
        <TvMode
          source={source}
          library={library}
          durations={durations}
          channels={channels}
          channel={safeChannel}
          onChannel={setChannel}
          onMenu={toMenu}
        />
      );
    case 'menu':
      return (
        <Menu
          channels={channels}
          channel={safeChannel}
          warningCount={library.warnings.length}
          libraryName={source.name}
          onWatch={(index) => {
            setChannel(index);
            toTv();
          }}
          onLibrary={() => toLibrary()}
          onWarnings={() => setView({ name: 'warnings' })}
          onSettings={() => setView({ name: 'settings' })}
          onChangeFolder={onChangeFolder}
        />
      );
    case 'settings':
      return <SettingsScreen channels={channels} onBack={toMenu} />;
    case 'warnings':
      return <Warnings warnings={library.warnings} onBack={toMenu} />;
    case 'library':
      return (
        <LibraryMode
          source={source}
          library={library}
          focusShow={view.focusShow}
          onOpen={(s) => setView({ name: 'show', showId: s.id })}
          onTv={toTv}
        />
      );
    case 'show':
      if (!show) return null;
      return (
        <ShowPage
          source={source}
          show={show}
          focusEpisode={view.focusEpisode}
          onPlay={(index) => setView({ name: 'player', showId: show.id, index })}
          onBack={() => toLibrary(show.id)}
        />
      );
    case 'player':
      if (!show) return null;
      return (
        <Player
          source={source}
          show={show}
          index={view.index}
          onIndex={(index) => setView({ name: 'player', showId: show.id, index })}
          onBack={() => setView({ name: 'show', showId: show.id, focusEpisode: view.index })}
        />
      );
  }
}
