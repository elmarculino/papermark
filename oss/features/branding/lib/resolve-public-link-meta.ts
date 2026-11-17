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
 * room brand, else team brand) when enabled; else no custom preview.
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

  const brand = dataroomBrand ?? teamBrand;
  if (brand?.customLinkPreviewEnabled) {
    return {
      enableCustomMetatag: true,
      metaTitle: brand.linkPreviewTitle || defaultTitle,
      metaDescription: brand.linkPreviewDescription ?? null,
      metaImage: brand.linkPreviewImage ?? null,
      metaFavicon: brand.linkPreviewFavicon || DEFAULT_FAVICON,
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
