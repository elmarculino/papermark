/**
 * [fork] Builds one bulk-download zip inside the jobs worker, replacing the
 * AWS Lambda that lib/trigger/bulk-download.ts invokes (used when
 * NEXT_PRIVATE_DOWNLOAD_LAMBDA_FUNCTION_NAME is unset). Same contract as the
 * Lambda: the folder structure's files (keys in the team bucket) go into the
 * zip under their folder paths, empty folders included; files flagged
 * `needsWatermark` are watermarked like single-document downloads
 * (lib/utils/watermark-pdf.ts). The zip is streamed to the team bucket and a
 * presigned download URL valid for `expirationHours` is returned.
 */
import type { StorageConfig } from "@/ee/features/storage/config";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import archiver from "archiver";
import { randomUUID } from "node:crypto";
import { PassThrough, Readable } from "node:stream";

import { getS3Client } from "@/lib/files/aws-client";
import type { BulkDownloadFolderStructure } from "@/lib/trigger/bulk-download";
import { buildWatermarkedPdf } from "@/lib/utils/watermark-pdf";

import { BULK_DOWNLOAD_PREFIX } from "./lib/trigger/cleanup-bulk-downloads";

const MAX_PRESIGN_SECONDS = 7 * 24 * 60 * 60; // SigV4 limit

export type ZipDownloadBatchParams = {
  storageConfig: StorageConfig;
  folderStructure: BulkDownloadFolderStructure;
  sourceBucket: string;
  watermarkConfig?: {
    enabled: boolean;
    config?: any;
    viewerData?: Record<string, string | null | undefined>;
  };
  zipFileName: string;
  expirationHours?: number;
};

/** "a/b/name.pdf" for path "/a/b"; "name (2).pdf" for a repeated name. */
function uniqueEntryName(
  used: Set<string>,
  folderPath: string,
  fileName: string,
): string {
  const dir = folderPath.replace(/^\/+|\/+$/g, "");
  const safe = fileName.replace(/[\\/]/g, "_") || "file";
  const dot = safe.lastIndexOf(".");
  const [stem, ext] =
    dot > 0 ? [safe.slice(0, dot), safe.slice(dot)] : [safe, ""];
  for (let n = 1; ; n++) {
    const name = `${dir ? `${dir}/` : ""}${n === 1 ? safe : `${stem} (${n})${ext}`}`;
    if (!used.has(name)) {
      used.add(name);
      return name;
    }
  }
}

export async function zipDownloadBatch({
  storageConfig: config,
  folderStructure,
  sourceBucket,
  watermarkConfig,
  zipFileName,
  expirationHours = 72,
}: ZipDownloadBatchParams): Promise<{ downloadUrl: string }> {
  // One storage config for every team in this fork (oss/features/storage).
  const client = getS3Client();
  const fileName = zipFileName.endsWith(".zip")
    ? zipFileName
    : `${zipFileName}.zip`;
  const key = `${BULK_DOWNLOAD_PREFIX}${randomUUID()}/${fileName}`;

  const archive = archiver("zip", { zlib: { level: 6 } });
  const body = new PassThrough();
  archive.pipe(body);
  const upload = new Upload({
    client,
    params: {
      Bucket: config.bucket,
      Key: key,
      Body: body,
      ContentType: "application/zip",
    },
  });
  const uploaded = upload.done();
  // archiver reports errors on the archive stream; surface them as a rejection.
  const archiveFailed = new Promise<never>((_, reject) =>
    archive.on("error", reject),
  );

  const fill = async () => {
    const used = new Set<string>();
    const folders = Object.values(folderStructure).sort((a, b) =>
      a.path.localeCompare(b.path),
    );
    for (const folder of folders) {
      const dir = folder.path.replace(/^\/+|\/+$/g, "");
      if (dir && folder.files.length === 0) {
        archive.append(Buffer.alloc(0), { name: `${dir}/` });
      }
      for (const file of folder.files) {
        const name = uniqueEntryName(used, folder.path, file.name);
        const object = await client.send(
          new GetObjectCommand({ Bucket: sourceBucket, Key: file.key }),
        );
        if (!object.Body) throw new Error(`Empty object: ${file.key}`);

        if (
          watermarkConfig?.enabled &&
          watermarkConfig.config &&
          file.needsWatermark
        ) {
          const fileBytes = await object.Body.transformToByteArray();
          const watermarked = await buildWatermarkedPdf({
            fileBytes,
            fileType: file.type === "image" ? "image" : "pdf",
            watermarkConfig: watermarkConfig.config,
            viewerData: watermarkConfig.viewerData ?? {},
            numPages: file.numPages ?? 1,
          });
          archive.append(Buffer.from(watermarked), { name });
        } else {
          // One file at a time: wait until archiver has consumed this stream.
          const stream = object.Body as Readable;
          await new Promise<void>((resolve, reject) => {
            stream.once("error", reject);
            archive.once("entry", () => resolve());
            archive.append(stream, { name });
          });
        }
      }
    }
    await archive.finalize();
  };

  await Promise.race([Promise.all([fill(), uploaded]), archiveFailed]);

  const downloadUrl = await getSignedUrl(
    client,
    new GetObjectCommand({
      Bucket: config.bucket,
      Key: key,
      ResponseContentDisposition: `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
    }),
    {
      expiresIn: Math.min(
        Math.round(expirationHours * 3600),
        MAX_PRESIGN_SECONDS,
      ),
    },
  );
  return { downloadUrl };
}
