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
import {
  AbortMultipartUploadCommand,
  GetObjectCommand,
  ListMultipartUploadsCommand,
} from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import archiver from "archiver";
import { randomUUID } from "node:crypto";
import { PassThrough, Readable } from "node:stream";

import { getS3Client } from "@/lib/files/aws-client";
import type { BulkDownloadFolderStructure } from "@/lib/trigger/bulk-download";
import { getFileNameWithPdfExtension } from "@/lib/utils";
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

async function abortOpenUploads(
  client: ReturnType<typeof getS3Client>,
  bucket: string,
  key: string,
) {
  const { Uploads = [] } = await client.send(
    new ListMultipartUploadsCommand({ Bucket: bucket, Prefix: key }),
  );
  for (const u of Uploads) {
    if (u.Key !== key || !u.UploadId) continue;
    await client.send(
      new AbortMultipartUploadCommand({
        Bucket: bucket,
        Key: key,
        UploadId: u.UploadId,
      }),
    );
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
  const fileName = `${zipFileName}.zip`;
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

  // The first failure anywhere (archiver, upload, a source stream) settles
  // `failed`; every wait below races it, so nothing is left hanging.
  let fail: (error: unknown) => void = () => {};
  const failed = new Promise<never>((_, reject) => (fail = reject));
  failed.catch(() => {});
  archive.on("error", (error) => fail(error));
  uploaded.catch((error) => fail(error));
  const guard = <T>(promise: Promise<T>) => Promise.race([promise, failed]);

  let current: Readable | undefined;
  // Appends one entry and waits until archiver has written that entry, so
  // entries (and their memory) go through one at a time.
  const add = (source: Buffer | Readable, name: string) =>
    guard(
      new Promise<void>((resolve, reject) => {
        const onEntry = (entry: { name: string }) => {
          if (entry.name !== name) return;
          archive.off("entry", onEntry);
          resolve();
        };
        archive.on("entry", onEntry);
        if (source instanceof Readable) {
          current = source;
          source.on("error", (error) => {
            reject(error);
            fail(error);
          });
        }
        archive.append(source, { name });
      }),
    );

  const fill = async () => {
    const used = new Set<string>();
    const folders = Object.values(folderStructure).sort((a, b) =>
      a.path.localeCompare(b.path),
    );
    for (const folder of folders) {
      const dir = folder.path.replace(/^\/+|\/+$/g, "");
      if (dir && folder.files.length === 0) {
        await add(Buffer.alloc(0), `${dir}/`);
      }
      for (const file of folder.files) {
        const watermark = Boolean(
          watermarkConfig?.enabled &&
          watermarkConfig.config &&
          file.needsWatermark,
        );
        const isImage = file.type === "image";
        // A watermarked image becomes a PDF, as in single downloads.
        const name = uniqueEntryName(
          used,
          folder.path,
          watermark && isImage
            ? getFileNameWithPdfExtension(file.name)
            : file.name,
        );
        const object = await guard(
          client.send(
            new GetObjectCommand({ Bucket: sourceBucket, Key: file.key }),
          ),
        );
        if (!object.Body) throw new Error(`Empty object: ${file.key}`);

        if (watermark) {
          const fileBytes = await guard(object.Body.transformToByteArray());
          const watermarked = await buildWatermarkedPdf({
            fileBytes,
            fileType: isImage ? "image" : "pdf",
            watermarkConfig: watermarkConfig!.config,
            viewerData: watermarkConfig!.viewerData ?? {},
            numPages: file.numPages ?? 1,
            flatten: true,
          });
          await add(Buffer.from(watermarked), name);
        } else {
          await add(object.Body as Readable, name);
        }
      }
    }
    archive.finalize();
    await guard(uploaded);
  };

  try {
    await fill();
  } catch (error) {
    // Tear down: no half-written multipart upload left in the bucket, no
    // open source stream, no buffered parts kept in the worker.
    fail(error);
    archive.abort();
    body.destroy();
    current?.destroy();
    await upload.abort().catch(() => {});
    await uploaded.catch(() => {});
    // lib-storage's abort() rejects done() without aborting a multipart upload
    // it already started; the key is unique, so abort whatever is open on it.
    await abortOpenUploads(client, config.bucket, key).catch(() => {});
    throw error;
  }

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
