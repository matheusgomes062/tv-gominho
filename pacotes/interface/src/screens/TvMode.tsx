import {
  buildTimeline,
  localIsoDate,
  locate,
  planDay,
  requiredPaths,
  secondsSinceMidnight,
  type Library,
  type Schedule,
  type Timeline,
  type TimelineEntry,
} from '@tv-chuvisco/nucleo';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Clock } from '../components/Clock';
import { Static } from '../components/Static';
import { useFlash } from '../components/useFlash';
import type { Durations } from '../media';
import { BACK_KEYS } from '../nav';
import { aspectClass, useSettings } from '../settings';
import type { BrowserLibrary } from '../sources/types';

interface Props {
  source: BrowserLibrary;
  library: Library;
  durations: Durations;
  channels: Schedule[];
  channel: number;
  onChannel(index: number): void;
  onMenu(): void;
}

type Status =
  | { name: 'tuning'; done: number; total: number }
  | { name: 'playing' }
  | { name: 'idle' }
  | { name: 'blocked' }
  | { name: 'empty' };

/** Minimum time on static when changing channels: it's part of the fun. */
const MIN_STATIC_MS = 700;
const OSD_MS = 4000;

export function TvMode({ source, library, durations, channels, channel, onChannel, onMenu }: Props) {
  const schedule = channels[channel];
  const { settings } = useSettings();
  // Settings that change what plays: tune() runs again when they do.
  const { interstitials, commercials, schedule: scheduleMode } = settings;
  const video = useRef<HTMLVideoElement>(null);
  const timeline = useRef<Timeline | null>(null);
  const index = useRef(0);
  const idleTimer = useRef<number | undefined>(undefined);
  const generation = useRef(0);

  const [status, setStatus] = useState<Status>({ name: 'tuning', done: 0, total: 0 });
  const [entry, setEntry] = useState<TimelineEntry>();
  const [nextEntry, setNextEntry] = useState<TimelineEntry>();
  const [osd, showOsd] = useFlash(OSD_MS, true);
  const [info, showInfo] = useFlash(OSD_MS);
  const [pointer, showPointer] = useFlash(2500);
  // play() needs the latest tune() without re-creating itself.
  const tuneRef = useRef<(token: number) => Promise<void>>(async () => undefined);

  /** Plays timeline entry `i`, starting `offset` seconds in. */
  const play = useCallback(
    async (i: number, offset: number, token: number) => {
      const current = timeline.current;
      const element = video.current;
      if (!current || !element || token !== generation.current) return;
      clearTimeout(idleTimer.current);

      if (i >= current.entries.length) {
        // End of the day's loop: tune again, which also picks up a new day after midnight.
        void tuneRef.current(token);
        return;
      }
      index.current = i;
      const item = current.entries[i]!;
      setEntry(item);
      setNextEntry(current.entries.slice(i + 1).find((e) => e.kind === 'episode'));

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
      element.currentTime = offset;
      // The <video> "playing" event switches the status; here we only catch autoplay blocks.
      element.play().catch((error: DOMException) => {
        if (token === generation.current && error.name === 'NotAllowedError') setStatus({ name: 'blocked' });
      });
    },
    [source],
  );

  /** Builds today's timeline for the channel and jumps to what is on air now. */
  const tune = useCallback(
    async (token: number) => {
      if (!schedule) {
        setStatus({ name: 'empty' });
        return;
      }
      const startedAt = performance.now();
      setStatus({ name: 'tuning', done: 0, total: 0 });
      const plan = planDay(schedule, library, localIsoDate(new Date()), { interstitials, commercials });
      await durations.load(requiredPaths(plan), (done, total) => {
        if (token === generation.current) setStatus({ name: 'tuning', done, total });
      });
      if (token !== generation.current) return;

      const built = buildTimeline(plan, durations.get);
      const wait = MIN_STATIC_MS - (performance.now() - startedAt);
      if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
      if (token !== generation.current) return;

      timeline.current = built;
      // TODO(phase 2): `horario`. `scheduleMode` is 'continuous' | 'real' | 'fromStart'; only
      // 'continuous' is implemented (locate() below). 'real' and 'fromStart' plug in here.
      const position = locate(built, secondsSinceMidnight(new Date()));
      if (!position) {
        setStatus({ name: 'empty' });
        return;
      }
      void play(position.index, position.offset, token);
    },
    [schedule, library, durations, play, interstitials, commercials, scheduleMode],
  );
  tuneRef.current = tune;

  // Tune whenever the channel changes.
  useEffect(() => {
    const token = ++generation.current;
    const element = video.current;
    void tune(token);
    showOsd();
    return () => {
      generation.current++;
      clearTimeout(idleTimer.current);
      element?.pause();
    };
  }, [tune, showOsd]);

  const changeChannel = useCallback(
    (delta: number) => {
      if (channels.length > 1) onChannel((channel + delta + channels.length) % channels.length);
      else showOsd();
    },
    [channel, channels.length, onChannel, showOsd],
  );

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const key = event.key;
      if (key === 'ArrowUp' || key === 'PageUp' || key === 'ChannelUp') changeChannel(1);
      else if (key === 'ArrowDown' || key === 'PageDown' || key === 'ChannelDown') changeChannel(-1);
      else if (/^[1-9]$/.test(key) && Number(key) <= channels.length) onChannel(Number(key) - 1);
      else if (key === 'Enter' || key === 'i' || key === 'Info') {
        if (status.name === 'blocked') void video.current?.play();
        else showInfo();
      } else if (BACK_KEYS.has(key) || key === 'm' || key === 'ContextMenu') onMenu();
      else return;
      event.preventDefault();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [changeChannel, channels.length, onChannel, onMenu, status.name, showInfo]);

  // Off-air/unplayable gaps always show static; `chuvisco_troca_canal` only decides about tuning.
  const showStatic = (status.name === 'tuning' && settings.channelChangeStatic) || status.name === 'idle';
  const showBlack = status.name === 'tuning' && !settings.channelChangeStatic;
  const item = entry?.item;

  return (
    <main
      className={`tv ${aspectClass(settings.aspect)} ${pointer ? 'show-pointer' : ''}`}
      onMouseMove={showPointer}
      onDoubleClick={() => void document.documentElement.requestFullscreen?.().catch(() => undefined)}
    >
      {/* The picture: a 4:3 frame, or the whole screen (see `proporcao`). Everything drawn on the TV goes inside. */}
      <div className="tv-screen">
        <video
          ref={video}
          className="tv-video"
          playsInline
          onPlaying={() => setStatus({ name: 'playing' })}
          onEnded={() => play(index.current + 1, 0, generation.current)}
          onError={() => {
            // Unplayable file: skip it after a moment of static.
            if (!video.current?.getAttribute('src')) return;
            setStatus({ name: 'idle' });
            const token = generation.current;
            idleTimer.current = window.setTimeout(() => play(index.current + 1, 0, token), 1500);
          }}
        />
        {showStatic && <Static className="tv-static" />}
        {showBlack && <div className="tv-black" />}

        {/* TODO(phase 2): CRT. The WebGL overlay (settings.crt) goes here: over the picture, under the OSD. */}

        {status.name === 'tuning' && status.total > 0 && (
          <p className="tv-tuning">
            Sintonizando… {status.done}/{status.total}
          </p>
        )}

        {(osd || status.name === 'tuning') && schedule && (
          <div className="osd-channel">
            <span className="osd-number">CH {String(channel + 1).padStart(2, '0')}</span>
            <span className="osd-name">{schedule.name}</span>
          </div>
        )}

        {settings.clock && <Clock />}

        {info && entry && (
          <div className="osd-info">
            {item?.kind === 'episode' ? (
              <>
                <strong>{item.show.title}</strong>
                <span>{item.episode.title}</span>
              </>
            ) : (
              <strong>Intervalo</strong>
            )}
            {nextEntry?.item?.kind === 'episode' && (
              <span className="osd-next">
                A seguir: {nextEntry.item.show.title} · {nextEntry.item.episode.title}
              </span>
            )}
          </div>
        )}
      </div>

      {status.name === 'blocked' && (
        <button className="tv-blocked button primary" onClick={() => void video.current?.play()}>
          ▶ Aperte OK para ligar a TV
        </button>
      )}

      {status.name === 'empty' && (
        <div className="tv-empty">
          <p>Nada para passar neste canal. Veja os avisos da biblioteca no menu.</p>
        </div>
      )}

      <button className="tv-menu-button button" onClick={onMenu} tabIndex={-1}>
        ☰ Menu
      </button>
    </main>
  );
}
