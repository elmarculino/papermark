/** Email invitations are not available in this fork: nobody is ever "uninvited". */
export function useUninvitedMembers(_dataroomId?: string, _groupId?: string) {
  return {
    uninvitedCount: 0,
    uninvitedEmails: [] as string[],
    loading: false,
    error: undefined,
    mutate: async () => undefined,
  };
}
