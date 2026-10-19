import { formatTimeOfDay, secondsSinceMidnight } from '@tv-gominho/nucleo';
import { useEffect, useState } from 'react';

/** The current time as HH:MM, refreshed while `enabled`. */
export function useClockText(enabled = true): string {
  const [time, setTime] = useState(() => formatTimeOfDay(secondsSinceMidnight(new Date())));

  useEffect(() => {
    if (!enabled) return;
    const update = () => setTime(formatTimeOfDay(secondsSinceMidnight(new Date())));
    update();
    const timer = window.setInterval(update, 5000);
    return () => clearInterval(timer);
  }, [enabled]);

  return time;
}

/** The `relogio_na_tela` clock: HH:MM in the green on-screen-display style. Pass `time` to show a text kept elsewhere. */
export function Clock({ className = '', time }: { className?: string; time?: string }) {
  const own = useClockText(time === undefined);
  return <div className={`osd-clock ${className}`}>{time ?? own}</div>;
}
