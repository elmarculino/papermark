import type { Brand } from "@prisma/client";

/** Id of a brand that is being created and isn't saved yet. */
export const DRAFT_TEAM_BRAND_ID = "__draft_brand__";

/** "Brand 2", "Brand 3", … : the first name not used by the team yet. */
export function nextTeamBrandName(brands: Pick<Brand, "name">[]): string {
  const names = new Set(brands.map((brand) => brand.name));
  for (let n = brands.length + 1; ; n++) {
    const candidate = `Brand ${n}`;
    if (!names.has(candidate)) return candidate;
  }
}
