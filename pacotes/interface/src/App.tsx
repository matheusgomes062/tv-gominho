import { createAutoSchedule, type Library, type Schedule } from '@tv-chuvisco/nucleo';
import { useCallback, useMemo, useState } from 'react';
import { Durations } from './media';
import { LibraryMode } from './screens/LibraryMode';
import { Menu } from './screens/Menu';
import { Player } from './screens/Player';
import { ShowPage } from './screens/ShowPage';
import { TvMode } from './screens/TvMode';
import { Warnings } from './screens/Warnings';
import { Welcome } from './screens/Welcome';
import type { BrowserLibrary } from './sources/types';

interface Session {
  source: BrowserLibrary;
  library: Library;
  durations: Durations;
  channels: Schedule[];
}

type View =
  | { name: 'tv' }
  | { name: 'menu' }
  | { name: 'warnings' }
  | { name: 'library'; focusShow?: string }
  | { name: 'show'; showId: string; focusEpisode?: number }
  | { name: 'player'; showId: string; index: number };

const CHANNEL_KEY = 'tv-chuvisco.canal';

export function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [view, setView] = useState<View>({ name: 'tv' });
  const [channel, setChannelState] = useState(() => {
    try {
      return Number(localStorage.getItem(CHANNEL_KEY)) || 0;
    } catch {
      return 0;
    }
  });

  const open = useCallback((source: BrowserLibrary, library: Library) => {
    const auto = createAutoSchedule(library);
    const channels = library.schedules.length > 0 ? library.schedules : auto ? [auto] : [];
    setSession({ source, library, durations: new Durations(source), channels });
    setView({ name: 'tv' });
  }, []);

  const setChannel = useCallback((index: number) => {
    setChannelState(index);
    try {
      localStorage.setItem(CHANNEL_KEY, String(index));
    } catch {
      // Storage blocked: the channel just isn't remembered.
    }
  }, []);

  const toTv = useCallback(() => setView({ name: 'tv' }), []);
  const toMenu = useCallback(() => setView({ name: 'menu' }), []);
  const toLibrary = useCallback((focusShow?: string) => setView({ name: 'library', focusShow }), []);

  const show = useMemo(() => {
    if (!session || !('showId' in view)) return undefined;
    return session.library.shows.find((s) => s.id === view.showId);
  }, [session, view]);

  if (!session) return <Welcome onOpen={open} />;

  const { source, library, durations, channels } = session;
  const safeChannel = channel < channels.length ? channel : 0;

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
          onChangeFolder={() => {
            source.dispose();
            setSession(null);
          }}
        />
      );
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
