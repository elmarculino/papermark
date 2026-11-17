import { type ReactNode, useState } from "react";

import { classifyDataroomBanner } from "@/ee/features/branding/lib/dataroom-banner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/**
 * Banner input: the caller's upload drop zone, plus a URL field that accepts an
 * image, a video file or a YouTube link.
 */
export function BannerEditor({
  banner,
  setBanner,
  setBannerBlobUrl,
  sizeHint,
  defaultBannerImage,
  onUrlApplied,
  dropZone,
}: {
  banner: string | null;
  setBanner: (banner: string | null) => void;
  setBannerBlobUrl: (url: string | null) => void;
  sizeHint?: string;
  defaultBannerImage?: string;
  onUrlApplied?: () => void;
  dropZone: ReactNode;
}) {
  const [url, setUrl] = useState("");
  const kind = classifyDataroomBanner(banner).kind;

  const applyUrl = () => {
    const value = url.trim();
    if (!value) return;
    setBanner(value);
    setBannerBlobUrl(null);
    setUrl("");
    onUrlApplied?.();
  };

  return (
    <div className="space-y-3">
      {dropZone}
      {sizeHint ? (
        <p className="text-xs text-muted-foreground">{sizeHint}</p>
      ) : null}
      <div className="flex gap-2">
        <Input
          type="url"
          placeholder="Or paste an image, video or YouTube URL"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              applyUrl();
            }
          }}
        />
        <Button type="button" variant="outline" onClick={applyUrl}>
          Apply
        </Button>
      </div>
      {kind === "video" || kind === "youtube" ? (
        <p className="text-xs text-muted-foreground">
          Video banners play in the Modern layout; other layouts show
          {defaultBannerImage ? " the default banner image" : " an image"}.
        </p>
      ) : null}
    </div>
  );
}
