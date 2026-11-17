// [fork] Missing from upstream's public repo. Helpers for API keys (RestrictedToken).
import { z } from "zod";

import prisma from "@/lib/prisma";

/** "user" keys belong to a member and die with their team access; "machine" keys stay team-scoped. */
export const RestrictedTokenSubjectTypeSchema = z.enum(["user", "machine"]);
export type RestrictedTokenSubjectType = z.infer<
  typeof RestrictedTokenSubjectTypeSchema
>;

/** Stored values are validated in app code; anything unknown reads as "user" (the column default). */
export function parseRestrictedTokenSubjectType(
  value: string | null | undefined,
): RestrictedTokenSubjectType {
  const parsed = RestrictedTokenSubjectTypeSchema.safeParse(value);
  return parsed.success ? parsed.data : "user";
}

/** Revokes a removed member's user-bound API keys for the team. Machine keys stay. */
export function revokeUserBoundTeamTokens(userId: string, teamId: string) {
  return prisma.restrictedToken.deleteMany({
    where: { userId, teamId, subjectType: { not: "machine" } },
  });
}
