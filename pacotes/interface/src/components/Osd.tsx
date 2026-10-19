import type { OsdSkin } from '@tv-gominho/nucleo';
import { useEffect, useState, type RefObject } from 'react';

// The TV's on-screen display for the channel, in the look of the chosen theme's skin
// (settings `osdSkin`). The skins are styled in styles.css under .skin-classic/.skin-vhs/.skin-modern.

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

/** The VCR counter text: "SP H:MM:SS". */
export function formatTimecode(seconds: number): string {
  return `SP ${Math.floor(seconds / 3600)}:${pad(Math.floor(seconds / 60) % 60)}:${pad(seconds % 60)}`;
}

/** The video's position in whole seconds, polled while `enabled` (state changes at most once a second). */
export function useVideoSeconds(video: RefObject<HTMLVideoElement | null>, enabled = true): number {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    const read = () => setSeconds(Math.floor(video.current?.currentTime ?? 0));
    read();
    const timer = window.setInterval(read, 500);
    return () => clearInterval(timer);
  }, [video, enabled]);
  return seconds;
}

/** A VCR counter (H:MM:SS) that follows the video. */
function Timecode({ video }: { video: RefObject<HTMLVideoElement | null> }) {
  const seconds = useVideoSeconds(video);
  return <span className="osd-timecode">{formatTimecode(seconds)}</span>;
}

interface Props {
  skin: OsdSkin;
  /** The channel number, counting from 1. */
  number: number;
  name: string;
  video: RefObject<HTMLVideoElement | null>;
  /** Extra class, e.g. the visually-hidden copy kept for screen readers while the CRT paints the OSD itself. */
  className?: string;
  /** Whether to show (and poll) the VHS counter; off for the hidden copy. */
  timecode?: boolean;
}

/** Channel number and name, shown for a few seconds after tuning. */
export function ChannelOsd({ skin, number, name, video, className = '', timecode = true }: Props) {
  return (
    <div className={`osd-channel ${className}`}>
      {skin === 'vhs' && (
        <span className="osd-play">
          PLAY<i className="osd-triangle" />
        </span>
      )}
      {skin === 'modern' ? (
        <span className="osd-badge">
          <span className="osd-number">{pad(number)}</span>
          <span className="osd-name">{name}</span>
        </span>
      ) : (
        <>
          <span className="osd-number">CH {pad(number)}</span>
          <span className="osd-name">{name}</span>
        </>
      )}
      {skin === 'vhs' && timecode && <Timecode video={video} />}
    </div>
  );
}
