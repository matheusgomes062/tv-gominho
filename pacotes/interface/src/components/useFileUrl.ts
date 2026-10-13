import { useEffect, useState } from 'react';
import type { BrowserLibrary } from '../sources/types';

/** URL for a library file (poster, backdrop...), or undefined while loading/missing. */
export function useFileUrl(library: BrowserLibrary, path: string | undefined): string | undefined {
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    let cancelled = false;
    setUrl(undefined);
    if (path) {
      library
        .url(path)
        .then((value) => !cancelled && setUrl(value))
        .catch(() => undefined);
    }
    return () => {
      cancelled = true;
    };
  }, [library, path]);
  return url;
}
