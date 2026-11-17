/** No billing when self-hosted: a team is never paused. */
export async function isTeamPaused(_team?: unknown): Promise<boolean> {
  return false;
}

export async function isTeamPausedById(
  _teamId?: string | null,
): Promise<boolean> {
  return false;
}
