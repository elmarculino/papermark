/** Social-preview (Open Graph) values for a shared link's page. */
export type ResolvedPublicLinkMeta = {
  enableCustomMetatag: boolean;
  metaTitle: string | null;
  metaDescription: string | null;
  metaImage: string | null;
  metaFavicon: string | null;
};

type LinkPreviewBrand = {
  customLinkPreviewEnabled?: boolean | null;
  linkPreviewTitle?: string | null;
  linkPreviewDescription?: string | null;
  linkPreviewImage?: string | null;
  linkPreviewFavicon?: string | null;
};

const DEFAULT_FAVICON = "/favicon.ico";

/**
 * The link's own custom meta tags win; else the brand's link preview (data
 * room brand, else team brand) when enabled; else no custom preview. A data
 * room preview's empty fields fall back to an enabled team preview.
 */
export function resolvePublicLinkMeta({
  link,
  teamBrand,
  dataroomBrand,
  defaultTitle,
}: {
  link: {
    enableCustomMetatag: boolean;
    metaTitle: string | null;
    metaDescription: string | null;
    metaImage: string | null;
    metaFavicon: string | null;
  };
  teamBrand: LinkPreviewBrand | null;
  dataroomBrand: LinkPreviewBrand | null;
  defaultTitle: string;
}): ResolvedPublicLinkMeta {
  if (link.enableCustomMetatag) {
    return {
      enableCustomMetatag: true,
      metaTitle: link.metaTitle || defaultTitle,
      metaDescription: link.metaDescription,
      metaImage: link.metaImage,
      metaFavicon: link.metaFavicon || DEFAULT_FAVICON,
    };
  }

  // The data room's own preview decides when present; when both it and the
  // team preview are enabled, its empty fields fall back to the team's.
  const brand = dataroomBrand ?? teamBrand;
  if (brand?.customLinkPreviewEnabled) {
    const fallback =
      dataroomBrand && teamBrand?.customLinkPreviewEnabled ? teamBrand : null;
    return {
      enableCustomMetatag: true,
      metaTitle:
        brand.linkPreviewTitle || fallback?.linkPreviewTitle || defaultTitle,
      metaDescription:
        brand.linkPreviewDescription ||
        fallback?.linkPreviewDescription ||
        null,
      metaImage: brand.linkPreviewImage || fallback?.linkPreviewImage || null,
      metaFavicon:
        brand.linkPreviewFavicon ||
        fallback?.linkPreviewFavicon ||
        DEFAULT_FAVICON,
    };
  }

  return {
    enableCustomMetatag: false,
    metaTitle: null,
    metaDescription: null,
    metaImage: null,
    metaFavicon: DEFAULT_FAVICON,
  };
}
