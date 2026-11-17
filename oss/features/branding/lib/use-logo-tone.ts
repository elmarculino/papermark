import { type SyntheticEvent, useCallback, useEffect, useState } from "react";

export type LogoTone = "light" | "dark" | null;

/**
 * Detects whether a logo is mostly light (needs a dark backdrop) or dark, from
 * the average luminance of its opaque pixels. Spread `imgProps` on the <img>
 * that displays the logo (with crossOrigin="anonymous"); `tone` is null until
 * the image loads or when the canvas can't be read.
 */
export function useLogoTone(src: string | null | undefined) {
  const [tone, setTone] = useState<LogoTone>(null);

  useEffect(() => {
    setTone(null);
  }, [src]);

  const onLoad = useCallback((event: SyntheticEvent<HTMLImageElement>) => {
    const img = event.currentTarget;
    try {
      const size = 32;
      const canvas = document.createElement("canvas");
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (!ctx) return;
      ctx.drawImage(img, 0, 0, size, size);
      const { data } = ctx.getImageData(0, 0, size, size);
      let total = 0;
      let weight = 0;
      for (let i = 0; i < data.length; i += 4) {
        const alpha = data[i + 3] / 255;
        if (alpha < 0.1) continue;
        const luminance =
          (0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]) /
          255;
        total += luminance * alpha;
        weight += alpha;
      }
      if (weight > 0) setTone(total / weight > 0.7 ? "light" : "dark");
    } catch {
      // cross-origin image without CORS headers: canvas is tainted
    }
  }, []);

  return { tone, imgProps: { onLoad } };
}
