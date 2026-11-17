/**
 * Runtime check for Office -> PDF conversion. Needs Postgres, S3-compatible
 * storage, a Gotenberg container, and a .docx to convert:
 *   GOTENBERG_URL=http://127.0.0.1:3000 POSTGRES_PRISMA_URL=... NEXT_PRIVATE_UPLOAD_...=... \
 *   npx tsx --tsconfig oss/tsconfig.verify.json oss/features/conversions/conversions.verify.ts path/to/file.docx
 */
import { convertDocumentVersionToPdf } from "@/ee/features/conversions/lib/trigger/convert-files";
import {
  CreateBucketCommand,
  GetObjectCommand,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import { readFileSync } from "node:fs";

import { getTeamS3ClientAndConfig } from "@/lib/files/aws-client";
import prisma from "@/lib/prisma";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function main() {
  const docxPath = process.argv[2];
  assert(docxPath, "usage: conversions.verify.ts <file.docx>");
  const suffix = Date.now().toString(36);
  const team = await prisma.team.create({ data: { name: `conv-${suffix}` } });
  try {
    const { client, config } = await getTeamS3ClientAndConfig(team.id);
    await client
      .send(new CreateBucketCommand({ Bucket: config.bucket }))
      .catch((error) => {
        if (!/BucketAlready/.test(String(error?.name))) throw error;
      });
    const originalKey = `${team.id}/doc_${suffix}/quarterly-report.docx`;
    await client.send(
      new PutObjectCommand({
        Bucket: config.bucket,
        Key: originalKey,
        Body: readFileSync(docxPath),
      }),
    );

    const document = await prisma.document.create({
      data: {
        name: "Quarterly Report.docx",
        file: originalKey,
        type: "docs",
        storageType: "S3_PATH",
        teamId: team.id,
        versions: {
          create: {
            versionNumber: 1,
            file: originalKey,
            originalFile: originalKey,
            type: "docs",
            contentType:
              "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            storageType: "S3_PATH",
            isPrimary: true,
          },
        },
      },
      include: { versions: true },
    });
    const version = document.versions[0];

    const pdfKey = await convertDocumentVersionToPdf({
      documentVersionId: version.id,
      teamId: team.id,
    });

    assert(
      pdfKey.startsWith(`${team.id}/doc_${suffix}/`) && pdfKey.endsWith(".pdf"),
      `PDF stored next to the original: ${pdfKey}`,
    );
    const pdf = await client.send(
      new GetObjectCommand({ Bucket: config.bucket, Key: pdfKey }),
    );
    const bytes = Buffer.from(await pdf.Body!.transformToByteArray());
    assert(
      bytes.subarray(0, 5).toString() === "%PDF-",
      "stored object is a PDF",
    );
    assert(pdf.ContentType === "application/pdf", "PDF content type");

    const updated = await prisma.documentVersion.findUnique({
      where: { id: version.id },
    });
    assert(updated?.file === pdfKey, "version.file now points at the PDF");
    assert(updated?.originalFile === originalKey, "original upload kept");

    // A version of another team is refused.
    const other = await prisma.team.create({ data: { name: `x-${suffix}` } });
    let refused = false;
    try {
      await convertDocumentVersionToPdf({
        documentVersionId: version.id,
        teamId: other.id,
      });
    } catch {
      refused = true;
    }
    await prisma.team.delete({ where: { id: other.id } });
    assert(refused, "conversion checks the team");

    console.log(
      `conversions.verify: ok (${bytes.length} byte PDF from ${docxPath.split("/").pop()})`,
    );
  } finally {
    await prisma.team.delete({ where: { id: team.id } });
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
