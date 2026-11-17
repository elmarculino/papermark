export type DataroomBannerKind = "none" | "image" | "video" | "youtube";

export type ClassifiedDataroomBanner = {
  kind: DataroomBannerKind;
  src: string | null;
  youtubeId?: string;
};

const VIDEO_EXTENSIONS = /\.(mp4|webm|mov|m4v|ogv)(\?|#|$)/i;

function youtubeIdOf(url: URL): string | null {
  const host = url.hostname.replace(/^www\.|^m\./, "");
  if (host === "youtu.be") return url.pathname.slice(1).split("/")[0] || null;
  if (host === "youtube.com" || host === "youtube-nocookie.com") {
    if (url.pathname === "/watch") return url.searchParams.get("v");
    const match = url.pathname.match(/^\/(embed|shorts|live)\/([^/?#]+)/);
    if (match) return match[2];
  }
  return null;
}

/**
 * Classifies a saved banner value: "no-banner" (hidden) or empty → none; a
 * YouTube URL → youtube (with its video id); a video file → video; else image.
 */
export function classifyDataroomBanner(
  src: string | null | undefined,
): ClassifiedDataroomBanner {
  if (!src || src === "no-banner") return { kind: "none", src: null };

  try {
    const url = new URL(src, "https://placeholder.invalid");
    const youtubeId = youtubeIdOf(url);
    if (youtubeId && /^[\w-]{6,20}$/.test(youtubeId)) {
      return { kind: "youtube", src, youtubeId };
    }
    if (VIDEO_EXTENSIONS.test(url.pathname)) return { kind: "video", src };
  } catch {
    // not a URL: treat as an image path
  }
  return { kind: "image", src };
}
