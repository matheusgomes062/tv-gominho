import { formatTimeOfDay, secondsSinceMidnight } from '@tv-chuvisco/nucleo';
import { useEffect, useState } from 'react';

/** The `relogio_na_tela` clock: HH:MM in the green on-screen-display style. */
export function Clock({ className = '' }: { className?: string }) {
  const [time, setTime] = useState(() => formatTimeOfDay(secondsSinceMidnight(new Date())));

  useEffect(() => {
    const update = () => setTime(formatTimeOfDay(secondsSinceMidnight(new Date())));
    update();
    const timer = window.setInterval(update, 5000);
    return () => clearInterval(timer);
  }, []);

  return <div className={`osd-clock ${className}`}>{time}</div>;
}
