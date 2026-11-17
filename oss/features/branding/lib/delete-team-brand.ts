import prisma from "@/lib/prisma";
import {
  clearCachedBrandLogo,
  writeCachedBrandLogo,
} from "@/lib/redis/brand-logo-cache";

/**
 * Deletes a team brand. Links and data rooms using it fall back to the team
 * default (their brandId is set null by the FK). If it was the default, the
 * oldest remaining brand becomes the default.
 */
export async function deleteTeamBrand({
  teamId,
  brand,
}: {
  teamId: string;
  brand: { id: string };
}): Promise<void> {
  const nextDefault = await prisma.$transaction(async (tx) => {
    const team = await tx.team.findUnique({
      where: { id: teamId },
      select: { defaultBrandId: true },
    });
    await tx.brand.delete({ where: { id: brand.id, teamId } });

    if (team?.defaultBrandId && team.defaultBrandId !== brand.id) return null;

    const replacement = await tx.brand.findFirst({
      where: { teamId },
      orderBy: { createdAt: "asc" },
    });
    await tx.team.update({
      where: { id: teamId },
      data: { defaultBrandId: replacement?.id ?? null },
    });
    return { replacement };
  });

  if (!nextDefault) return;
  if (nextDefault.replacement) {
    await writeCachedBrandLogo(teamId, nextDefault.replacement);
  } else {
    await clearCachedBrandLogo(teamId);
  }
}
