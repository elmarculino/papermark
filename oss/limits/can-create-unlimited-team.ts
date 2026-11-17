/** Self-hosted: every new team is created on the unlimited plan. */
export async function canCreateUnlimitedTeam(
  _userId: string,
): Promise<boolean> {
  return true;
}
