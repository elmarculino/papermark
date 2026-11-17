import { GetObjectCommand } from "@aws-sdk/client-s3";
import { AbortTaskRunError, logger, task } from "@trigger.dev/sdk";
import path from "node:path";

import { getTeamS3ClientAndConfig } from "@/lib/files/aws-client";
import { putFileServer } from "@/lib/files/put-file-server";
import prisma from "@/lib/prisma";
import { convertPdfToImageRoute } from "@/lib/trigger/pdf-to-image-route";
import {
  convertFilesToPdfQueue,
  convertKeynoteToPdfQueue,
} from "@/lib/trigger/queues";

/**
 * Office/Keynote → PDF for self-hosting, via Gotenberg (LibreOffice behind an HTTP
 * API: https://gotenberg.dev). Set GOTENBERG_URL, e.g. http://gotenberg:3000.
 * The PDF replaces the version's `file`; `originalFile` keeps the upload. Then the
 * existing PDF → page-images task takes over.
 */
type ConvertPayload = {
  documentId: string;
  documentVersionId: string;
  teamId: string;
};

// Fallback when the stored key has no extension; LibreOffice picks its importer by extension.
const EXTENSION_BY_CONTENT_TYPE: Record<string, string> = {
  "application/msword": ".doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
    ".docx",
  "application/vnd.oasis.opendocument.text": ".odt",
  "application/rtf": ".rtf",
  "text/plain": ".txt",
  "application/vnd.ms-powerpoint": ".ppt",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation":
    ".pptx",
  "application/vnd.oasis.opendocument.presentation": ".odp",
  "application/vnd.apple.keynote": ".key",
  "application/x-iwork-keynote-sffkey": ".key",
};

async function readObject(teamId: string, key: string): Promise<Buffer> {
  const { client, config } = await getTeamS3ClientAndConfig(teamId);
  const object = await client.send(
    new GetObjectCommand({ Bucket: config.bucket, Key: key }),
  );
  if (!object.Body) throw new Error(`Empty object: ${key}`);
  return Buffer.from(await object.Body.transformToByteArray());
}

/** Converts one document version's original upload to PDF and stores it. Returns the PDF key. */
export async function convertDocumentVersionToPdf({
  documentVersionId,
  teamId,
}: Pick<ConvertPayload, "documentVersionId" | "teamId">): Promise<string> {
  const gotenbergUrl = process.env.GOTENBERG_URL;
  if (!gotenbergUrl) {
    throw new AbortTaskRunError("GOTENBERG_URL is not set");
  }

  const version = await prisma.documentVersion.findUnique({
    where: { id: documentVersionId },
    select: {
      file: true,
      originalFile: true,
      contentType: true,
      storageType: true,
      document: { select: { name: true, teamId: true } },
    },
  });
  if (!version || version.document.teamId !== teamId) {
    throw new AbortTaskRunError("Document version not found");
  }
  if (version.storageType !== "S3_PATH") {
    throw new AbortTaskRunError(
      `Unsupported storage type: ${version.storageType}`,
    );
  }

  const sourceKey = version.originalFile ?? version.file;
  const ext =
    path.extname(sourceKey).toLowerCase() ||
    EXTENSION_BY_CONTENT_TYPE[version.contentType ?? ""] ||
    "";
  if (!ext) {
    throw new AbortTaskRunError(
      `Cannot tell the file type of ${sourceKey} (${version.contentType})`,
    );
  }

  const source = await readObject(teamId, sourceKey);
  logger.info("Converting to PDF", { sourceKey, bytes: source.length });

  const form = new FormData();
  form.append("files", new Blob([new Uint8Array(source)]), `document${ext}`);
  const response = await fetch(
    `${gotenbergUrl.replace(/\/+$/, "")}/forms/libreoffice/convert`,
    { method: "POST", body: form },
  );
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 500);
    // 4xx: the file can't be converted; retrying won't help.
    if (response.status >= 400 && response.status < 500) {
      throw new AbortTaskRunError(
        `Conversion rejected (${response.status}): ${detail}`,
      );
    }
    throw new Error(`Conversion failed (${response.status}): ${detail}`);
  }
  const pdf = Buffer.from(await response.arrayBuffer());

  // Keep the PDF next to the original: keys are `<teamId>/<docId>/<file>`.
  const docId = sourceKey.split("/")[1];
  const baseName = path.parse(version.document.name).name || "document";
  const { data: pdfKey } = await putFileServer({
    file: { name: `${baseName}.pdf`, type: "application/pdf", buffer: pdf },
    teamId,
    docId,
  });

  await prisma.documentVersion.update({
    where: { id: documentVersionId },
    data: { file: pdfKey, originalFile: sourceKey },
  });
  logger.info("Stored PDF", { pdfKey, bytes: pdf.length });
  return pdfKey;
}

async function convertThenRenderPages(payload: ConvertPayload) {
  await convertDocumentVersionToPdf(payload);
  await convertPdfToImageRoute.trigger(payload, {
    idempotencyKey: `${payload.teamId}-${payload.documentVersionId}`,
    tags: [
      `team_${payload.teamId}`,
      `document_${payload.documentId}`,
      `version:${payload.documentVersionId}`,
    ],
  });
}

export const convertFilesToPdfTask = task({
  id: "convert-files-to-pdf",
  queue: convertFilesToPdfQueue,
  retry: { maxAttempts: 3 },
  run: convertThenRenderPages,
});

export const convertKeynoteToPdfTask = task({
  id: "convert-keynote-to-pdf",
  queue: convertKeynoteToPdfQueue,
  retry: { maxAttempts: 3 },
  run: convertThenRenderPages,
});
