import { createAutoSchedule, createShowChannels, findChannelIndex, type Library } from '@tv-gominho/nucleo';
import { useCallback, useMemo, useRef, useState } from 'react';
import { Durations } from './media';
import { LibraryMode } from './screens/LibraryMode';
import { Menu } from './screens/Menu';
import { QuickSettings } from './overlays/QuickSettings';
import { SettingsPanel } from './overlays/SettingsPanel';
import { Player } from './screens/Player';
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
  | { name: 'warnings' }
  | { name: 'library'; focusShow?: string }
  | { name: 'show'; showId: string; focusEpisode?: number }
  | { name: 'player'; showId: string; index: number };

/** Layers over the live picture (TV or Player), newest last: Back closes the last one. */
type Overlay = 'menu' | 'quick' | 'settings';

const CHANNEL_KEY = 'tv-gominho.canal';

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

  // The overlays keep the picture playing underneath; full screens (library, warnings…) replace it and close them.
  const [overlays, setOverlays] = useState<Overlay[]>([]);
  const openOverlay = useCallback((name: Overlay, keep = false) => setOverlays((stack) => [...(keep ? stack : []), name]), []);
  const closeOverlay = useCallback(() => setOverlays((stack) => stack.slice(0, -1)), []);
  const closeOverlays = useCallback(() => setOverlays([]), []);
  const goTo = useCallback((next: View, then: Overlay[] = []) => {
    setView(next);
    setOverlays(then);
  }, []);
  const onPicture = view.name === 'tv' || view.name === 'player';
  const overlay = onPicture ? overlays.at(-1) : undefined;

  const toTv = useCallback(() => goTo({ name: 'tv' }), [goTo]);
  const toLibrary = useCallback((focusShow?: string) => goTo({ name: 'library', focusShow }), [goTo]);

  const show = useMemo(() => {
    if (!('showId' in view)) return undefined;
    return library.shows.find((s) => s.id === view.showId);
  }, [library, view]);

  const layers = overlay && (
    <>
      {overlay === 'menu' && (
        <Menu
          channels={channels}
          channel={safeChannel}
          warningCount={library.warnings.length}
          libraryName={source.name}
          onWatch={(index) => {
            setChannel(index);
            closeOverlays();
          }}
          onLibrary={() => toLibrary()}
          onWarnings={() => goTo({ name: 'warnings' })}
          onQuick={() => openOverlay('quick', true)}
          onSettings={() => openOverlay('settings', true)}
          onChangeFolder={onChangeFolder}
          onBack={closeOverlay}
        />
      )}
      {overlay === 'quick' && <QuickSettings channels={channels} onAll={() => openOverlay('settings', true)} onBack={closeOverlay} />}
      {overlay === 'settings' && <SettingsPanel channels={channels} libraryName={source.name} onBack={closeOverlay} />}
    </>
  );

  switch (view.name) {
    case 'tv':
      return (
        <>
        <TvMode
          source={source}
          library={library}
          durations={durations}
          channels={channels}
          channel={safeChannel}
          onChannel={setChannel}
          overlayOpen={overlay !== undefined}
          onMenu={() => openOverlay('menu')}
          onQuick={() => openOverlay('quick')}
        />
        {layers}
        </>
      );
    case 'warnings':
      return <Warnings warnings={library.warnings} onBack={() => goTo({ name: 'tv' }, ['menu'])} />;
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
        <>
          <Player
            source={source}
            show={show}
            index={view.index}
            onIndex={(index) => setView({ name: 'player', showId: show.id, index })}
            onBack={() => setView({ name: 'show', showId: show.id, focusEpisode: view.index })}
            overlayOpen={overlay !== undefined}
            onQuick={() => openOverlay('quick')}
          />
          {layers}
        </>
      );
  }
}
