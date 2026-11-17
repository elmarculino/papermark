import { task } from "@trigger.dev/sdk";

/** No-ops: viewer conversations are not available in this fork. */
export const sendConversationMessageNotificationTask = task({
  id: "oss-noop-conversation-message-notification",
  run: async (_payload: Record<string, unknown>) => ({ skipped: true }),
});

export const sendConversationMentionNotificationTask = task({
  id: "oss-noop-conversation-mention-notification",
  run: async (_payload: Record<string, unknown>) => ({ skipped: true }),
});

export const sendConversationTeamMemberNotificationTask = task({
  id: "oss-noop-conversation-team-member-notification",
  run: async (_payload: Record<string, unknown>) => ({ skipped: true }),
});
