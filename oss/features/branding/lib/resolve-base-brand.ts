import { Prisma } from "@prisma/client";

import prisma from "@/lib/prisma";

/** Team-brand fields the link/data-room viewers render. */
export const teamBrandViewerSelect = {
  logo: true,
  hideLogo: true,
  banner: true,
  brandColor: true,
  accentColor: true,
  accentButtonColor: true,
  applyAccentColorToDataroomView: true,
  welcomeMessage: true,
  ctaLabel: true,
  ctaUrl: true,
  privacyPolicyUrl: true,
  cardLayout: true,
  showFolderTree: true,
  viewerLayoutPreset: true,
  viewerHeaderStyle: true,
  hideFolderIconsInMain: true,
  defaultLanguage: true,
} satisfies Prisma.BrandSelect;

/** Team-brand fields for a shared link's social preview (Open Graph). */
export const teamBrandOgSelect = {
  customLinkPreviewEnabled: true,
  linkPreviewTitle: true,
  linkPreviewDescription: true,
  linkPreviewImage: true,
  linkPreviewFavicon: true,
} satisfies Prisma.BrandSelect;

/** Team-brand fields for the workflow entry screen. */
export const teamBrandWorkflowSelect = {
  logo: true,
  hideLogo: true,
  brandColor: true,
  accentColor: true,
  accentButtonColor: true,
  welcomeMessage: true,
  privacyPolicyUrl: true,
  defaultLanguage: true,
} satisfies Prisma.BrandSelect;

/** The team's default brand, else its oldest brand, else null. */
export async function findDefaultBrand<
  S extends Prisma.BrandSelect | undefined = undefined,
>(teamId: string, select?: S) {
  const team = await prisma.team.findUnique({
    where: { id: teamId },
    select: { defaultBrandId: true },
  });
  const query = {
    where: team?.defaultBrandId
      ? { id: team.defaultBrandId, teamId }
      : { teamId },
    orderBy: { createdAt: "asc" as const },
    ...(select ? { select } : {}),
  };
  const brand = await prisma.brand.findFirst(query);
  if (brand || !team?.defaultBrandId) {
    return brand as Prisma.BrandGetPayload<{ select: S }> | null;
  }
  // Default points at a missing brand: fall back to the oldest.
  return (await prisma.brand.findFirst({
    where: { teamId },
    orderBy: { createdAt: "asc" },
    ...(select ? { select } : {}),
  })) as Prisma.BrandGetPayload<{ select: S }> | null;
}

export async function resolveDefaultBrandId(
  teamId: string,
): Promise<string | null> {
  const brand = await findDefaultBrand(teamId, { id: true });
  return brand?.id ?? null;
}

/** Returns `brandId` when it belongs to the team; null for empty or foreign ids. */
export async function resolveOwnedBrandId(
  teamId: string,
  brandId: string | null | undefined,
): Promise<string | null> {
  if (!brandId) return null;
  const brand = await prisma.brand.findFirst({
    where: { id: brandId, teamId },
    select: { id: true },
  });
  return brand?.id ?? null;
}

/**
 * The team brand that applies: the link's brand, else the data room's base
 * brand, else the team default. Brands of other teams are ignored.
 */
export async function resolveBaseBrand<S extends Prisma.BrandSelect>({
  teamId,
  linkBrandId,
  dataroomBrandId,
  select,
}: {
  teamId: string;
  linkBrandId?: string | null;
  dataroomBrandId?: string | null;
  select: S;
}): Promise<Prisma.BrandGetPayload<{ select: S }> | null> {
  for (const id of [linkBrandId, dataroomBrandId]) {
    if (!id) continue;
    const brand = await prisma.brand.findFirst({
      where: { id, teamId },
      select,
    });
    if (brand) return brand as Prisma.BrandGetPayload<{ select: S }>;
  }
  return findDefaultBrand(teamId, select);
}

/** Updates the team's default brand, or creates one and makes it the default. */
export async function persistDefaultBrand({
  teamId,
  create,
  update,
}: {
  teamId: string;
  create: Prisma.BrandUncheckedCreateInput;
  update: Prisma.BrandUncheckedUpdateInput;
}) {
  const existing = await findDefaultBrand(teamId, { id: true });
  return prisma.$transaction(async (tx) => {
    const brand = existing
      ? await tx.brand.update({ where: { id: existing.id }, data: update })
      : await tx.brand.create({ data: { ...create, teamId } });
    await tx.team.update({
      where: { id: teamId },
      data: { defaultBrandId: brand.id },
    });
    return brand;
  });
}
