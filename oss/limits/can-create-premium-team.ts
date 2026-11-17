/** Unused when self-hosted (canCreateUnlimitedTeam always wins); kept for interface parity. */
export const PREMIUM_TEAM_LIMIT = Infinity;

export async function getPremiumTeamEligibility(_userId: string): Promise<{
  isPremiumAdmin: boolean;
  canCreate: boolean;
}> {
  return { isPremiumAdmin: false, canCreate: false };
}
