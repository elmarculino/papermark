import { useEffect, useRef, useState } from "react";

import { BRANDING_PREVIEW_MESSAGE } from "@/ee/features/branding/lib/use-branding-preview-params";

/**
 * A browser-window frame around a preview page. The iframe loads once with the
 * initial params; later changes are posted to it (see useBrandingPreviewParams)
 * so it updates without reloading or flashing.
 */
export function BrandingPreviewChrome({
  name,
  basePath,
  urlLabel,
  params,
}: {
  name: string;
  basePath: string;
  urlLabel: string;
  params: Record<string, string>;
}) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [initialSrc] = useState(
    () => `${basePath}?${new URLSearchParams(params).toString()}`,
  );
  const serialized = JSON.stringify(params);

  useEffect(() => {
    iframeRef.current?.contentWindow?.postMessage(
      { type: BRANDING_PREVIEW_MESSAGE, params: JSON.parse(serialized) },
      window.location.origin,
    );
  }, [serialized]);

  return (
    <div className="flex h-full min-h-[480px] flex-col overflow-hidden rounded-lg border bg-gray-100 shadow-sm dark:bg-gray-900">
      <div className="flex items-center gap-2 border-b bg-white px-3 py-2 dark:bg-gray-950">
        <span className="h-2.5 w-2.5 rounded-full bg-red-400" />
        <span className="h-2.5 w-2.5 rounded-full bg-yellow-400" />
        <span className="h-2.5 w-2.5 rounded-full bg-green-400" />
        <span className="ml-2 truncate rounded bg-gray-100 px-2 py-0.5 text-xs text-muted-foreground dark:bg-gray-900">
          {urlLabel}
        </span>
      </div>
      <iframe
        ref={iframeRef}
        name={name}
        title={`${name} preview`}
        src={initialSrc}
        className="w-full flex-1 border-0 bg-white"
        onLoad={() =>
          iframeRef.current?.contentWindow?.postMessage(
            { type: BRANDING_PREVIEW_MESSAGE, params: JSON.parse(serialized) },
            window.location.origin,
          )
        }
      />
    </div>
  );
}
