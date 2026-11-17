import { task } from "@trigger.dev/sdk";

/** No-op: there are no trials when self-hosted (every team is unlimited). */
type TrialEmailPayload = {
  to: string;
  name?: string;
  teamId?: string;
  useCase?: string;
};

export const sendDataroomTrialInfoEmailTask = task({
  id: "send-dataroom-trial-info-email",
  run: async (_payload: TrialEmailPayload) => ({ skipped: true }),
});

export const sendDataroomTrial24hReminderEmailTask = task({
  id: "send-dataroom-trial-24h-reminder-email",
  run: async (_payload: TrialEmailPayload) => ({ skipped: true }),
});

export const sendDataroomTrialExpiredEmailTask = task({
  id: "send-dataroom-trial-expired-email",
  run: async (_payload: TrialEmailPayload) => ({ skipped: true }),
});
