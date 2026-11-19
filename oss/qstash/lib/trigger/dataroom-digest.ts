/**
 * [fork] Data room digest emails on the jobs layer's cron schedules, replacing
 * the QStash schedules that called /api/cron/dataroom-digest/{daily,weekly}
 * (same times: daily 09:00 UTC, weekly Monday 09:00 UTC).
 */
import { logger, schedules } from "@trigger.dev/sdk";

import { processDataroomDigest } from "@/lib/emails/process-dataroom-digest";

export const dataroomDigestDailyTask = schedules.task({
  id: "dataroom-digest-daily",
  cron: "0 9 * * *",
  run: async () => {
    // QStash's own schedule sends it when QStash is configured.
    if (process.env.QSTASH_TOKEN)
      return { skipped: "QStash schedules digests" };
    const result = await processDataroomDigest("daily");
    logger.info("Daily data room digest done", { ...result });
    return result;
  },
});

export const dataroomDigestWeeklyTask = schedules.task({
  id: "dataroom-digest-weekly",
  cron: "0 9 * * 1",
  run: async () => {
    // QStash's own schedule sends it when QStash is configured.
    if (process.env.QSTASH_TOKEN)
      return { skipped: "QStash schedules digests" };
    const result = await processDataroomDigest("weekly");
    logger.info("Weekly data room digest done", { ...result });
    return result;
  },
});
