import { useEffect, useState } from 'react';

/** The image at `url`, once it has loaded; null while loading, without a url, or when it cannot be decoded. */
export function useImage(url: string | undefined): HTMLImageElement | null {
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  useEffect(() => {
    setImage(null);
    if (!url) return;
    let cancelled = false;
    const element = new Image();
    element.onload = () => !cancelled && setImage(element);
    element.src = url;
    return () => {
      cancelled = true;
    };
  }, [url]);
  return image;
}
