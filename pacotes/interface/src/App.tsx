import { createAutoSchedule, createShowChannels, findChannelIndex, type Library, type Schedule } from '@tv-gominho/nucleo';
import { useCallback, useMemo, useRef, useState } from 'react';
import type { HubTarget } from './hub-model';
import { Durations } from './media';
import { LibraryMode } from './screens/LibraryMode';
import { Menu } from './screens/Menu';
import { QuickSettings } from './overlays/QuickSettings';
import { SettingsPanel } from './overlays/SettingsPanel';
import { BlocklistScreen } from './overlays/BlocklistScreen';
import { ChannelEditor } from './overlays/ChannelEditor';
import { ScheduleHub } from './overlays/ScheduleHub';
import { WeekWizard } from './overlays/WeekWizard';
import { Player } from './screens/Player';
import { ShowPage } from './screens/ShowPage';
import { TvMode } from './screens/TvMode';
import { Warnings } from './screens/Warnings';
import { Welcome } from './screens/Welcome';
import { SettingsProvider, useSettings } from './settings';
import { rereadLibrary } from './sources/save';
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
type Overlay = 'menu' | 'quick' | 'settings' | 'schedule' | 'wizard' | 'editor' | 'blocklist';

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
        onLibraryChange={(library) => setSession((current) => (current ? { ...current, library } : current))}
        onChangeFolder={() => {
          session.source.dispose();
          setSession(null);
        }}
      />
    </SettingsProvider>
  );
}

/** The channels of a library: its grades, or the automatic channel when it has none, plus one per show if asked. */
function channelsOf(library: Library, perShow: boolean): Schedule[] {
  const auto = createAutoSchedule(library);
  const base = library.schedules.length > 0 ? library.schedules : auto ? [auto] : [];
  return perShow ? [...base, ...createShowChannels(library)] : base;
}

function Main({ session, onChangeFolder, onLibraryChange }: { session: Session; onChangeFolder(): void; onLibraryChange(library: Library): void }) {
  const { source, library, durations } = session;
  const { settings } = useSettings();

  const channels = useMemo(() => channelsOf(library, settings.channelsPerShow), [library, settings.channelsPerShow]);

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

  /** After a channel was written into the folder: reads the library again, keeping the channel on air. */
  const reloadLibrary = useCallback(async () => {
    const fresh = await rereadLibrary(source);
    if (!fresh) return false;
    // A new grade can sort before the one on air, so the index may shift: follow the channel by its id.
    const onAir = channels[safeChannel]?.id;
    const moved = onAir === undefined ? -1 : channelsOf(fresh, settings.channelsPerShow).findIndex((entry) => entry.id === onAir);
    if (moved >= 0) setChannel(moved);
    onLibraryChange(fresh);
    return true;
  }, [source, channels, safeChannel, settings.channelsPerShow, setChannel, onLibraryChange]);

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
  // The grade being edited in the channel editor (its id, the grade file name).
  const [editing, setEditing] = useState<string | null>(null);
  // The row of the schedule screen a sub-screen was opened from: focus goes back there when it closes.
  const [hubFocus, setHubFocus] = useState<HubTarget | null>(null);
  // The schedule screen was opened from Configurações: that panel focuses its "Programação" row when it comes back.
  const [settingsFromHub, setSettingsFromHub] = useState(false);
  const openHub = (fromSettings: boolean) => {
    setHubFocus(null);
    setSettingsFromHub(fromSettings);
    openOverlay('schedule', true);
  };
  const editedSchedule = editing === null ? undefined : library.schedules.find((entry) => entry.id === editing);

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
          onSettings={() => {
            setSettingsFromHub(false);
            openOverlay('settings', true);
          }}
          onSchedule={() => openHub(false)}
          onChangeFolder={onChangeFolder}
          onBack={closeOverlay}
        />
      )}
      {overlay === 'quick' && <QuickSettings channels={channels} onAll={() => {
            setSettingsFromHub(false);
            openOverlay('settings', true);
          }}
          onBack={closeOverlay} />}
      {overlay === 'settings' && (
        <SettingsPanel channels={channels} libraryName={source.name} focusSchedule={settingsFromHub} onSchedule={() => openHub(true)} onBack={closeOverlay} />
      )}
      {overlay === 'blocklist' && <BlocklistScreen source={source} library={library} onSaved={reloadLibrary} onBack={closeOverlay} />}
      {overlay === 'schedule' && (
        <ScheduleHub
          library={library}
          focus={hubFocus}
          onWizard={() => {
            setHubFocus({ kind: 'wizard' });
            openOverlay('wizard', true);
          }}
          onBlocklist={() => {
            setHubFocus({ kind: 'blocklist' });
            openOverlay('blocklist', true);
          }}
          onEdit={(id) => {
            setHubFocus({ kind: 'edit', id });
            setEditing(id);
            openOverlay('editor', true);
          }}
          onBack={closeOverlay}
        />
      )}
      {overlay === 'editor' && editedSchedule && (
        <ChannelEditor
          source={source}
          library={library}
          schedule={editedSchedule}
          onSaved={reloadLibrary}
          onWatch={(id) => {
            const index = findChannelIndex(channels, id);
            if (index >= 0) setChannel(index);
            closeOverlays();
          }}
          onBack={closeOverlay}
        />
      )}
      {overlay === 'wizard' && (
        <WeekWizard
          source={source}
          library={library}
          durations={durations}
          channels={channels}
          onSaved={reloadLibrary}
          onWatch={(id) => {
            const index = findChannelIndex(channels, id);
            if (index >= 0) setChannel(index);
            closeOverlays();
          }}
          onBack={closeOverlay}
        />
      )}
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
