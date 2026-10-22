import {
  buildTimeline,
  channelAdBreaks,
  localIsoDate,
  locate,
  nextAiringDate,
  planDay,
  requiredPaths,
  resolveFromStart,
  resolveReal,
  resumeAt,
  secondsSinceMidnight,
  type Library,
  type Resume,
  type Schedule,
  type ScheduleMode,
  type Timeline,
  type TimelineEntry,
  type TimelineOptions,
} from '@tv-gominho/nucleo';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Clock, useClockText } from '../components/Clock';
import { OffAir } from '../components/OffAir';
import { Crt } from '../components/Crt';
import { ChannelOsd, formatTimecode, useVideoSeconds } from '../components/Osd';
import type { OsdState } from '../components/osd-painter';
import { Static } from '../components/Static';
import { useFileUrl } from '../components/useFileUrl';
import { useFlash } from '../components/useFlash';
import { useImage } from '../components/useImage';
import type { Durations } from '../media';
import { BACK_KEYS } from '../nav';
import { aspectClass, useSettings } from '../settings';
import type { BrowserLibrary } from '../sources/types';
import { Icon } from '../components/Icon';

interface Props {
  source: BrowserLibrary;
  library: Library;
  durations: Durations;
  channels: Schedule[];
  channel: number;
  onChannel(index: number): void;
  /** A layer (menu, quick settings, settings) is open over the picture: it keeps playing, but ignores the keys. */
  overlayOpen: boolean;
  onMenu(): void;
  onQuick(): void;
}

type Status =
  | { name: 'tuning'; done: number; total: number }
  | { name: 'playing' }
  | { name: 'idle' }
  /** `horario: real` with nothing scheduled: the test card, until `resume`. */
  | { name: 'offair'; resume: Resume }
  | { name: 'blocked' }
  | { name: 'empty' };

/** Minimum time on static when changing channels: it's part of the fun. */
const MIN_STATIC_MS = 700;
const OSD_MS = 4000;
/** `horario: real` re-checks the clock this often, to notice the computer waking up from sleep. */
const CLOCK_CHECK_MS = 10_000;
/** A real-clock video this far from the wall clock is out of sync: tune again. */
const MAX_DRIFT_SECONDS = 5;
/** An episode part ends this many seconds before the cut point, so the first frame after it never shows. */
const PART_END_MARGIN = 0.04;

/**
 * Marathons (`horario: do_inicio`) of this session, per channel: when each one
 * started and from which day. Going back to the channel resumes it as if it
 * had kept running; reloading the page starts over. See docs/configuracoes.md.
 */
const marathons = new Map<string, { startedAt: number; startDate: string }>();

function timelineOptions(mode: ScheduleMode): TimelineOptions {
  // real: blocks start at their time, long gaps are off the air. do_inicio: no gaps at all.
  if (mode === 'real') return { keepLongGaps: true };
  if (mode === 'fromStart') return { maxGapFill: 0 };
  return {};
}

/** The wall-clock moment (ms) a channel comes back. */
function resumeTime(resume: Resume): number {
  const [year, month, day] = resume.date.split('-').map(Number) as [number, number, number];
  return new Date(year, month - 1, day, 0, 0, resume.seconds).getTime();
}

/** Double click: into fullscreen, or back out of it. */
async function toggleFullscreen() {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await document.documentElement.requestFullscreen?.();
  } catch {
    // Fullscreen refused (e.g. blocked by the browser): nothing to do.
  }
}

export function TvMode({ source, library, durations, channels, channel, onChannel, overlayOpen, onMenu, onQuick }: Props) {
  const schedule = channels[channel];
  const { settings } = useSettings();
  // Settings that change what plays: tune() runs again when they do.
  const { interstitials, commercials, schedule: scheduleMode } = settings;
  // The channel's own `intervalos` over the general ones.
  const { every: breakEvery, ads: breakAds, afterEpisode: breakAfterEpisode, bumpers: breakBumpers } = schedule ? channelAdBreaks(settings, schedule) : settings.adBreaks;
  const video = useRef<HTMLVideoElement>(null);
  const timeline = useRef<Timeline | null>(null);
  const index = useRef(0);
  const idleTimer = useRef<number | undefined>(undefined);
  // Episodes cut by commercial breaks: the entry whose file is loaded in the <video>, and the one we already advanced from.
  const loadedIndex = useRef(-1);
  const advancedFrom = useRef(-1);
  const generation = useRef(0);
  // `horario: real`: the timer that returns from "fora do ar", when it fires, and the clock shift of the timeline on air.
  const resumeTimer = useRef<number | undefined>(undefined);
  const resumeAtMs = useRef(0);
  const dayShift = useRef(0);
  // True while the CRT canvas is drawing the picture (the plain <video>/static/black layers hide).
  const [crtActive, setCrtActive] = useState(false);

  const [status, setStatus] = useState<Status>({ name: 'tuning', done: 0, total: 0 });
  const [entry, setEntry] = useState<TimelineEntry>();
  const [osd, showOsd] = useFlash(OSD_MS, true);
  const [info, showInfo] = useFlash(OSD_MS);
  const [pointer, showPointer] = useFlash(2500);
  // play() needs the latest tune() without re-creating itself.
  const tuneRef = useRef<(token: number) => Promise<void>>(async () => undefined);
  const nextDayRef = useRef<(token: number) => Promise<void>>(async () => undefined);
  const modeRef = useRef(scheduleMode);
  modeRef.current = scheduleMode;
  const statusRef = useRef(status);
  statusRef.current = status;

  /** Shows the "fora do ar" card until `resume`, then tunes again. */
  const goOffAir = useCallback((resume: Resume, token: number) => {
    const element = video.current;
    clearTimeout(idleTimer.current);
    element?.pause();
    element?.removeAttribute('src');
    element?.load();
    index.current = 0;
    setEntry(undefined);
    setStatus({ name: 'offair', resume });
    resumeAtMs.current = resumeTime(resume);
    clearTimeout(resumeTimer.current);
    // A little late rather than a little early: tune() reads the clock again.
    resumeTimer.current = window.setTimeout(
      () => {
        if (token === generation.current) void tuneRef.current(token);
      },
      Math.max(0, resumeAtMs.current - Date.now()) + 100,
    );
  }, []);

  /** Plays timeline entry `i`, starting `offset` seconds in. */
  const play = useCallback(
    async (i: number, offset: number, token: number) => {
      const current = timeline.current;
      const element = video.current;
      if (!current || !element || token !== generation.current) return;
      clearTimeout(idleTimer.current);

      if (i >= current.entries.length) {
        if (modeRef.current === 'fromStart') void nextDayRef.current(token);
        // End of the day's loop (continuous) or of the day's schedule (real): tune again,
        // which also picks up a new day after midnight, or the "fora do ar" card.
        else void tuneRef.current(token);
        return;
      }
      if (modeRef.current === 'real' && offset === 0) {
        // The next block has not started yet: nothing on air in between.
        const now = new Date();
        const startsIn = current.entries[i]!.start - dayShift.current - secondsSinceMidnight(now);
        if (startsIn > 1) {
          goOffAir(resumeAt(localIsoDate(now), current.entries[i]!.start - dayShift.current), token);
          return;
        }
      }
      index.current = i;
      advancedFrom.current = -1;
      loadedIndex.current = -1;
      const item = current.entries[i]!;
      setEntry(item);
      if (item.kind === 'idle' || !item.path) {
        element.removeAttribute('src');
        element.load();
        setStatus({ name: 'idle' });
        idleTimer.current = window.setTimeout(() => play(i + 1, 0, token), (item.duration - offset) * 1000);
        return;
      }

      const url = await source.url(item.path);
      if (token !== generation.current) return;
      element.src = url;
      // An episode part that comes after a commercial break starts in the middle of its file.
      element.currentTime = (item.fileOffset ?? 0) + offset;
      loadedIndex.current = i;
      // The <video> "playing" event switches the status; here we only catch autoplay blocks.
      element.play().catch((error: DOMException) => {
        if (token === generation.current && error.name === 'NotAllowedError') setStatus({ name: 'blocked' });
      });
    },
    [source, goOffAir],
  );

  /** Moves on from entry `from` (once, whatever fires first: the end of the part or of the file). */
  const advance = useCallback(
    (from: number) => {
      if (advancedFrom.current === from) return;
      advancedFrom.current = from;
      void play(from + 1, 0, generation.current);
    },
    [play],
  );

  /** An episode part ends before its file does: leave for the commercials as soon as the cut point is reached. */
  const checkPartEnd = useCallback(() => {
    const element = video.current;
    const entry = timeline.current?.entries[index.current];
    if (!element || !entry?.part || entry.part.index >= entry.part.count) return;
    if (loadedIndex.current !== index.current) return;
    if (element.currentTime >= (entry.fileOffset ?? 0) + entry.duration - PART_END_MARGIN) advance(index.current);
  }, [advance]);

  // Checked on every video frame where the browser supports it (the cut lands on the right frame), and on timeupdate otherwise.
  useEffect(() => {
    const element = video.current;
    if (!element || !('requestVideoFrameCallback' in element)) return;
    let handle = 0;
    let stopped = false;
    const watch = () => {
      handle = element.requestVideoFrameCallback(() => {
        if (stopped) return;
        checkPartEnd();
        watch();
      });
    };
    watch();
    return () => {
      stopped = true;
      element.cancelVideoFrameCallback(handle);
    };
  }, [checkPartEnd]);

  /** Where to go when the file of entry `i` cannot be played: past all the parts of the same episode. */
  const afterBrokenFile = useCallback((i: number) => {
    const entries = timeline.current?.entries ?? [];
    const broken = entries[i];
    if (!broken?.part) return i + 1;
    let last = i;
    entries.forEach((e, j) => {
      if (j > i && e.item === broken.item && e.part) last = j;
    });
    return last + 1;
  }, []);

  /** Plans and lays out one day of the channel (durations are read as needed). */
  const loadTimeline = useCallback(
    async (date: string, token: number, mode: ScheduleMode): Promise<Timeline> => {
      const plan = planDay(schedule!, library, date, { interstitials, commercials, bumpers: breakBumpers });
      await durations.load(requiredPaths(plan), (done, total) => {
        if (token === generation.current) setStatus({ name: 'tuning', done, total });
      });
      // Commercial breaks need `commercials` (the plan has no commercials otherwise).
      const adBreaks = { every: breakEvery, ads: breakAds, afterEpisode: breakAfterEpisode, bumpers: breakBumpers };
      return buildTimeline(plan, durations.get, { ...timelineOptions(mode), adBreaks });
    },
    [schedule, library, durations, interstitials, commercials, breakEvery, breakAds, breakAfterEpisode, breakBumpers],
  );

  /** Builds the channel's timeline and jumps to what is on air now, according to `horario`. */
  const tune = useCallback(
    async (token: number) => {
      if (!schedule) {
        setStatus({ name: 'empty' });
        return;
      }
      const startedAt = performance.now();
      clearTimeout(resumeTimer.current);
      setStatus({ name: 'tuning', done: 0, total: 0 });
      const mode = scheduleMode;
      const timelineOf = (date: string) => loadTimeline(date, token, mode);
      /** Keeps the static on for a moment, like changing channels on a real TV. */
      const staticMoment = async () => {
        const wait = MIN_STATIC_MS - (performance.now() - startedAt);
        if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
      };
      if (mode !== 'fromStart') marathons.delete(schedule.id);
      dayShift.current = 0;

      if (mode === 'real') {
        // The first pass reads the durations; the clock is read again after the static, so the position is exact.
        const resolve = () => {
          const now = new Date();
          return resolveReal(schedule, localIsoDate(now), secondsSinceMidnight(now), timelineOf);
        };
        await resolve();
        if (token !== generation.current) return;
        await staticMoment();
        const tuned = await resolve();
        if (token !== generation.current) return;
        if (!tuned) {
          setStatus({ name: 'empty' });
          return;
        }
        if (tuned.offAir) {
          timeline.current = null;
          goOffAir(tuned.resume, token);
          return;
        }
        timeline.current = tuned.timeline;
        dayShift.current = tuned.shift;
        void play(tuned.index, tuned.offset, token);
        return;
      }

      if (mode === 'fromStart') {
        const resolve = (commit: boolean) => {
          let marathon = marathons.get(schedule.id);
          if (!marathon) {
            marathon = { startedAt: Date.now(), startDate: localIsoDate(new Date()) };
            if (commit) marathons.set(schedule.id, marathon);
          }
          return resolveFromStart(schedule, marathon.startDate, (Date.now() - marathon.startedAt) / 1000, timelineOf);
        };
        await resolve(false);
        if (token !== generation.current) return;
        await staticMoment();
        // A new marathon starts now, after the static; a running one resumes where it would be.
        const tuned = await resolve(true);
        if (token !== generation.current) return;
        if (!tuned) {
          setStatus({ name: 'empty' });
          return;
        }
        timeline.current = tuned.timeline;
        void play(tuned.index, tuned.offset, token);
        return;
      }

      const built = await timelineOf(localIsoDate(new Date()));
      if (token !== generation.current) return;
      await staticMoment();
      if (token !== generation.current) return;

      timeline.current = built;
      const position = locate(built, secondsSinceMidnight(new Date()));
      if (!position) {
        setStatus({ name: 'empty' });
        return;
      }
      void play(position.index, position.offset, token);
    },
    [schedule, scheduleMode, loadTimeline, goOffAir, play],
  );
  tuneRef.current = tune;

  /** `horario: do_inicio`: the day's timeline is over, the marathon goes on with the next airing day. */
  const nextDay = useCallback(
    async (token: number) => {
      const current = timeline.current;
      if (!schedule || !current) return;
      const next = await resolveFromStart(schedule, nextAiringDate(schedule, current.date), 0, (date) =>
        loadTimeline(date, token, 'fromStart'),
      );
      if (token !== generation.current) return;
      if (!next) {
        setStatus({ name: 'empty' });
        return;
      }
      timeline.current = next.timeline;
      void play(next.index, next.offset, token);
    },
    [schedule, loadTimeline, play],
  );
  nextDayRef.current = nextDay;

  // Tune whenever the channel changes.
  useEffect(() => {
    const token = ++generation.current;
    const element = video.current;
    void tune(token);
    showOsd();
    return () => {
      generation.current++;
      clearTimeout(idleTimer.current);
      clearTimeout(resumeTimer.current);
      element?.pause();
    };
  }, [tune, showOsd]);

  // `horario: real` follows the wall clock, which keeps running while the tab sleeps or the computer is suspended:
  // check it now and then, and when the tab comes back. Out-of-sync video or a missed comeback tune again.
  useEffect(() => {
    if (scheduleMode !== 'real') return;
    const check = () => {
      if (document.visibilityState === 'hidden') return;
      const token = generation.current;
      const current = statusRef.current;
      if (current.name === 'offair') {
        if (Date.now() >= resumeAtMs.current) void tuneRef.current(token);
        return;
      }
      const day = timeline.current;
      const playing = day?.entries[index.current];
      if (!day || !playing || (current.name !== 'playing' && current.name !== 'idle')) return;
      const position = secondsSinceMidnight(new Date()) + dayShift.current - playing.start;
      const actual = current.name === 'playing' ? (video.current?.currentTime ?? position) - (playing.fileOffset ?? 0) : position;
      if (position >= playing.duration + 1 || Math.abs(position - actual) > MAX_DRIFT_SECONDS) void tuneRef.current(token);
    };
    const timer = window.setInterval(check, CLOCK_CHECK_MS);
    document.addEventListener('visibilitychange', check);
    window.addEventListener('focus', check);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', check);
      window.removeEventListener('focus', check);
    };
  }, [scheduleMode]);

  const changeChannel = useCallback(
    (delta: number) => {
      if (channels.length > 1) onChannel((channel + delta + channels.length) % channels.length);
      else showOsd();
    },
    [channel, channels.length, onChannel, showOsd],
  );

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      // An overlay owns the keys while it is open (and anything it handled is already marked).
      if (overlayOpen || event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return;
      const key = event.key;
      if (key === 'ArrowUp' || key === 'PageUp' || key === 'ChannelUp') changeChannel(1);
      else if (key === 'ArrowDown' || key === 'PageDown' || key === 'ChannelDown') changeChannel(-1);
      else if (/^[1-9]$/.test(key) && Number(key) <= channels.length) onChannel(Number(key) - 1);
      else if (key === 'Enter' || key === 'i' || key === 'Info') {
        if (status.name === 'blocked') void video.current?.play();
        else showInfo();
      } else if (key === 's' || key === 'S' || key === 'Settings' || key === 'ArrowLeft' || key === 'ArrowRight') onQuick();
      else if (BACK_KEYS.has(key) || key === 'm' || key === 'ContextMenu') onMenu();
      else return;
      event.preventDefault();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [changeChannel, channels.length, onChannel, overlayOpen, onMenu, onQuick, status.name, showInfo]);

  // Off-air/unplayable gaps always show static; `chuvisco_troca_canal` only decides about tuning.
  const showStatic = (status.name === 'tuning' && settings.channelChangeStatic) || status.name === 'idle';
  const showBlack = status.name === 'tuning' && !settings.channelChangeStatic;
  const item = entry?.item;

  // With the WebGL tube, the OSD is painted into it (components/osd-painter.ts) so it gets the CRT treatment; the DOM
  // copies below stay as the visually-hidden text for screen readers. Without it, the DOM OSD is the visible one.
  const channelShown = (osd || status.name === 'tuning') && !!schedule;
  const clockText = useClockText(settings.clock && crtActive);
  const videoSeconds = useVideoSeconds(video, crtActive && settings.osdSkin === 'vhs' && channelShown);
  const infoTitle = info && entry ? (item?.kind === 'episode' ? item.show.title : 'Intervalo') : null;
  const infoSubtitle =
    info && entry && item?.kind === 'episode' ? `${item.episode.title}${entry.part ? ` (parte ${entry.part.index} de ${entry.part.count})` : ''}` : null;
  const channelName = schedule?.name;
  // The `marca_dagua` bug stays on while a program plays; bumpers, commercials, static and the test card hide it.
  const watermarkImage = useImage(useFileUrl(source, settings.watermarkEnabled ? (settings.watermark ?? undefined) : undefined));
  const watermarkCorner = settings.watermarkEnabled && settings.watermark !== null;
  const watermark = watermarkCorner && status.name === 'playing' && item?.kind === 'episode' ? watermarkImage : null;
  const osdState = useMemo<OsdState>(
    () => ({
      skin: settings.osdSkin,
      channel:
        channelShown && channelName !== undefined
          ? { number: channel + 1, name: channelName, timecode: settings.osdSkin === 'vhs' ? formatTimecode(videoSeconds) : null }
          : null,
      info: infoTitle !== null ? { title: infoTitle, subtitle: infoSubtitle } : null,
      clock: settings.clock ? clockText : null,
      watermark,
      watermarkCorner,
    }),
    [settings.osdSkin, settings.clock, channelShown, channelName, channel, videoSeconds, infoTitle, infoSubtitle, clockText, watermark, watermarkCorner],
  );
  const hidden = crtActive ? 'osd-sr' : '';

  return (
    <main
      className={`tv ${aspectClass(settings.aspect)} skin-${settings.osdSkin} ${watermarkCorner ? 'has-watermark' : ''} ${pointer ? 'show-pointer' : ''}`}
      onMouseMove={showPointer}
      onDoubleClick={() => void toggleFullscreen()}
    >
      {/* The picture: a 4:3 frame, or the whole screen (see `proporcao`). Everything drawn on the TV goes inside. */}
      <div className="tv-screen">
        <video
          ref={video}
          className={`tv-video ${crtActive ? 'crt-hidden' : ''}`}
          playsInline
          onPlaying={() => setStatus({ name: 'playing' })}
          onTimeUpdate={checkPartEnd}
          onEnded={() => advance(index.current)}
          onError={() => {
            // Unplayable file: skip it (all the parts of the episode) after a moment of static.
            if (!video.current?.getAttribute('src')) return;
            setStatus({ name: 'idle' });
            const token = generation.current;
            const next = afterBrokenFile(index.current);
            idleTimer.current = window.setTimeout(() => play(next, 0, token), 1500);
          }}
        />
        {!crtActive && showStatic && <Static className="tv-static" />}
        {!crtActive && showBlack && <div className="tv-black" />}

        {/* The CRT tube draws the video, the static and the black screen itself (see components/Crt.tsx). */}
        {settings.crt.enabled && (
          <Crt
            video={video}
            settings={settings.crt}
            aspect={settings.aspect}
            view={showStatic ? 'static' : showBlack ? 'black' : 'picture'}
            osd={osdState}
            onActive={setCrtActive}
          />
        )}

        {status.name === 'offair' && schedule && <OffAir channelName={schedule.name} resume={status.resume} />}

        {status.name === 'tuning' && status.total > 0 && (
          <p className="tv-tuning">
            Sintonizando… {status.done}/{status.total}
          </p>
        )}

        {(osd || status.name === 'tuning') && schedule && (
          <ChannelOsd skin={settings.osdSkin} number={channel + 1} name={schedule.name} video={video} className={hidden} timecode={!crtActive} />
        )}

        {/* With the WebGL tube the watermark is painted into it (components/osd-painter.ts); this is the plain screen's copy. */}
        {!crtActive && watermark && <img className="tv-watermark" src={watermark.src} alt="" draggable={false} />}

        {settings.clock && <Clock className={hidden} time={crtActive ? clockText : undefined} />}

        {info && entry && (
          <div className={`osd-info ${hidden}`}>
            {item?.kind === 'episode' ? (
              <>
                <strong>{item.show.title}</strong>
                <span>
                  {item.episode.title}
                  {entry.part && ` (parte ${entry.part.index} de ${entry.part.count})`}
                </span>
              </>
            ) : (
              <strong>Intervalo</strong>
            )}
          </div>
        )}
      </div>

      {status.name === 'blocked' && (
        <button className="tv-blocked button primary" onClick={() => void video.current?.play()}>
          <Icon name="play" /> Aperte OK para ligar a TV
        </button>
      )}

      {status.name === 'empty' && (
        <div className="tv-empty">
          <p>Nada para passar neste canal. Veja os avisos da biblioteca no menu.</p>
        </div>
      )}

      <div className="tv-corner-buttons">
        <button className="button" onClick={onMenu} tabIndex={-1}>
          <Icon name="menu" /> Menu
        </button>
        <button className="button" onClick={onQuick} tabIndex={-1}>
          <Icon name="settings" /> Ajustes
        </button>
      </div>
    </main>
  );
}
