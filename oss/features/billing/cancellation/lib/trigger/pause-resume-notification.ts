import { task } from "@trigger.dev/sdk";

/** No-op: billing is disabled when self-hosted. */
export const sendPauseResumeNotificationTask = task({
  id: "send-pause-resume-notification",
  run: async (_payload: { teamId: string }) => ({ skipped: true }),
});
