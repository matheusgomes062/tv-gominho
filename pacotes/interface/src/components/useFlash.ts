import { useCallback, useEffect, useRef, useState } from 'react';

/** A flag that turns itself off `ms` after the last `show()`; for on-screen displays. */
export function useFlash(ms: number, initial = false): [boolean, () => void] {
  const [visible, setVisible] = useState(initial);
  const timer = useRef<number | undefined>(undefined);

  const show = useCallback(() => {
    setVisible(true);
    clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setVisible(false), ms);
  }, [ms]);

  useEffect(() => {
    if (initial) timer.current = window.setTimeout(() => setVisible(false), ms);
    return () => clearTimeout(timer.current);
  }, [initial, ms]);

  return [visible, show];
}
