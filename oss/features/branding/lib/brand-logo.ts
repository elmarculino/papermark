/** The fields that decide what goes in a viewer's logo slot. */
export type BrandLogoFields = {
  logo?: string | null;
  hideLogo?: boolean | null;
};

export type ResolvedBrandLogo =
  | { kind: "custom"; src: string }
  | { kind: "papermark" }
  | { kind: "none" };

/** Hidden wins, then an uploaded logo, else the default (Papermark) logo. */
export function resolveBrandLogo(
  brand: BrandLogoFields | null | undefined,
): ResolvedBrandLogo {
  if (brand?.hideLogo) return { kind: "none" };
  if (brand?.logo) return { kind: "custom", src: brand.logo };
  return { kind: "papermark" };
}
