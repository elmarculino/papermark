/** Select value meaning "this data room's own brand" (Dataroom.brandId / Link.brandId = null). */
export const CUSTOM_DATAROOM_BRAND = "__dataroom_brand__";
export const CUSTOM_DATAROOM_BRAND_LABEL = "Custom data room branding";

/**
 * Whether a data-room link shows a team brand instead of the data room's own
 * brand: yes when the link or the data room picks a team brand, or when the
 * data room has no brand of its own.
 */
export function inheritsTeamBrand({
  linkBrandId,
  dataroomBrandId,
  hasDataroomBrand,
}: {
  linkBrandId?: string | null;
  dataroomBrandId?: string | null;
  hasDataroomBrand: boolean;
}): boolean {
  return Boolean(linkBrandId || dataroomBrandId || !hasDataroomBrand);
}

type TeamBrandLike = {
  hideLogo?: boolean | null;
  accentButtonColor?: string | null;
  privacyPolicyUrl?: string | null;
};
type DataroomBrandLike = {
  hideLogo?: boolean | null;
  accentButtonColor?: string | null;
};

/**
 * The brand a data-room viewer renders. The data room's own brand is
 * authoritative, except fields it leaves null that are meant to inherit:
 * hideLogo and accentButtonColor, plus the team-only privacy policy URL.
 */
export function resolveDisplayedDataroomBrand<
  D extends DataroomBrandLike,
  T extends TeamBrandLike,
>({
  dataroomBrand,
  teamBrand,
  inheritTeamBrand,
}: {
  dataroomBrand: D | null;
  teamBrand: T | null;
  inheritTeamBrand: boolean;
}):
  | (Omit<D, "hideLogo"> & {
      hideLogo: boolean;
      privacyPolicyUrl: string | null;
    })
  | T
  | null {
  if (inheritTeamBrand || !dataroomBrand) return teamBrand;
  return {
    ...dataroomBrand,
    hideLogo: dataroomBrand.hideLogo ?? teamBrand?.hideLogo ?? false,
    accentButtonColor:
      dataroomBrand.accentButtonColor ?? teamBrand?.accentButtonColor ?? null,
    privacyPolicyUrl: teamBrand?.privacyPolicyUrl ?? null,
  };
}
