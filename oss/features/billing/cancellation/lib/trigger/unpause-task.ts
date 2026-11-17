import { task } from "@trigger.dev/sdk";

/** No-op: billing is disabled when self-hosted. */
export const automaticUnpauseTask = task({
  id: "automatic-unpause",
  run: async (_payload: { teamId: string }) => ({ skipped: true }),
});
