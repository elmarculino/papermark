import { useRouter } from "next/router";

import { useEffect, useState } from "react";

/** Message the branding editor posts to its preview iframes (see BrandingPreviewChrome). */
export const BRANDING_PREVIEW_MESSAGE = "papermark:branding-preview-params";

export type BrandingPreviewParams = Partial<
  Record<
    | "brandLogo"
    | "hideLogo"
    | "brandColor"
    | "brandBanner"
    | "accentColor"
    | "accentButtonColor"
    | "applyAccentColorToDataroomView"
    | "cardLayout"
    | "showFolderTree"
    | "viewerHeaderStyle"
    | "hideFolderIconsInMain"
    | "ctaLabel"
    | "ctaUrl"
    | "welcomeMessage",
    string
  >
>;

function fromQuery(query: Record<string, string | string[] | undefined>) {
  const params: Record<string, string> = {};
  for (const [key, value] of Object.entries(query)) {
    if (typeof value === "string") params[key] = value;
  }
  return params as BrandingPreviewParams;
}

/**
 * Preview pages read their settings from the URL on first paint, then follow
 * live updates posted by the editor (same origin only), so the iframe never
 * reloads while the user edits.
 */
export function useBrandingPreviewParams(): BrandingPreviewParams {
  const router = useRouter();
  const [params, setParams] = useState<BrandingPreviewParams>(() =>
    fromQuery(router.query),
  );

  useEffect(() => {
    if (router.isReady) setParams(fromQuery(router.query));
  }, [router.isReady, router.query]);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      if (event.data?.type !== BRANDING_PREVIEW_MESSAGE) return;
      if (event.data.params && typeof event.data.params === "object") {
        setParams(event.data.params as BrandingPreviewParams);
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  return params;
}
