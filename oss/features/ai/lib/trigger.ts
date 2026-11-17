import { task } from "@trigger.dev/sdk";

/** Viewer AI chat is not available: no content type is ever sent for AI processing. */
export const SUPPORTED_AI_CONTENT_TYPES: string[] = [];

export const addFileToVectorStoreTask = task({
  id: "oss-noop-add-file-to-vector-store",
  run: async (_payload: Record<string, unknown>) => ({ skipped: true }),
});

export const processDocumentForAITask = task({
  id: "oss-noop-process-document-for-ai",
  run: async (_payload: Record<string, unknown>) => ({ skipped: true }),
});
