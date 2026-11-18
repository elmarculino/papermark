/**
 * [fork] Deletes bulk-download zips (zip-download-batch.ts writes them under
 * `bulk-downloads/` in the team bucket) once their links have expired. The
 * download job and its links expire after 3 days; zips are kept 4.
 */
import { getStorageConfig } from "@/ee/features/storage/config";
import { DeleteObjectsCommand, ListObjectsV2Command } from "@aws-sdk/client-s3";
import { logger, schedules } from "@trigger.dev/sdk";

import { getS3Client } from "@/lib/files/aws-client";

export const BULK_DOWNLOAD_PREFIX = "bulk-downloads/";
const KEEP_MS = 4 * 24 * 60 * 60 * 1000;

export async function deleteExpiredBulkDownloads(now = Date.now()) {
  const { bucket } = getStorageConfig();
  const client = getS3Client();
  let deleted = 0;
  let token: string | undefined;
  do {
    const page = await client.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: BULK_DOWNLOAD_PREFIX,
        ContinuationToken: token,
      }),
    );
    const expired = (page.Contents ?? []).filter(
      (o) =>
        o.Key && o.LastModified && now - o.LastModified.getTime() > KEEP_MS,
    );
    if (expired.length > 0) {
      await client.send(
        new DeleteObjectsCommand({
          Bucket: bucket,
          Delete: { Objects: expired.map((o) => ({ Key: o.Key! })) },
        }),
      );
      deleted += expired.length;
    }
    token = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (token);
  return { deleted };
}

export const cleanupBulkDownloadsTask = schedules.task({
  id: "cleanup-bulk-downloads",
  cron: "30 2 * * *",
  run: async () => {
    const result = await deleteExpiredBulkDownloads();
    logger.info("Expired bulk-download zips deleted", result);
    return result;
  },
});
