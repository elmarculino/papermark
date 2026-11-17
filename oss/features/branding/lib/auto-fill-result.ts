export const AUTO_FILL_NOT_FOUND_MESSAGE =
  "We couldn't find a logo or colors on that website.";

/** True when an auto-fill result has something to apply (banner only counts when allowed). */
export function autoFillHasBrandAssets(
  data:
    | {
        logo?: string | null;
        banner?: string | null;
        brandColor?: string | null;
        accentColor?: string | null;
      }
    | null
    | undefined,
  { allowBanner }: { allowBanner: boolean },
): boolean {
  if (!data) return false;
  return Boolean(
    data.logo ||
    data.brandColor ||
    data.accentColor ||
    (allowBanner && data.banner),
  );
}
