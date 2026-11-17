import { Prisma } from "@prisma/client";

import prisma from "@/lib/prisma";

/**
 * Saves a data room's own brand and switches the data room to it (clears the
 * inherited team brand, Dataroom.brandId).
 */
export async function upsertDataroomBrandAndClearInherited({
  dataroomId,
  teamId,
  data,
}: {
  dataroomId: string;
  teamId: string;
  data: Omit<Prisma.DataroomBrandUncheckedCreateInput, "id" | "dataroomId">;
}) {
  return prisma.$transaction(async (tx) => {
    const dataroom = await tx.dataroom.findFirst({
      where: { id: dataroomId, teamId },
      select: { id: true },
    });
    if (!dataroom) throw new Error("Dataroom not found");

    const brand = await tx.dataroomBrand.upsert({
      where: { dataroomId },
      create: { ...data, dataroomId },
      update: data,
    });
    await tx.dataroom.update({
      where: { id: dataroomId },
      data: { brandId: null },
    });
    return brand;
  });
}
