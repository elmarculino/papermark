"use client";

import { useEffect } from "react";

import { toast } from "sonner";

/**
 * Email invitations are not available in this fork. Callers still show their
 * "Invite" buttons, so instead of a modal, tell the user and close right away.
 */
export function InviteViewersModal({
  open,
  setOpen,
}: {
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
  useEffect(() => {
    if (open) {
      toast.info("Email invitations are not available in this edition.");
      setOpen(false);
    }
  }, [open, setOpen]);

  return null;
}
