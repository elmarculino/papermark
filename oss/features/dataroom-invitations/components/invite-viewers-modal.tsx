/** Email invitations are not available in this fork: the modal never renders. */
export function InviteViewersModal(_props: {
  open: boolean;
  setOpen: (open: boolean) => void;
  dataroomId: string;
  dataroomName?: string;
  groupId?: string;
  linkId?: string;
  defaultEmails?: string[];
  canSend?: boolean;
  onSuccess?: () => void;
  [key: string]: unknown;
}) {
  return null;
}
