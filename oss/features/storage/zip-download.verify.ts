/**
 * Runtime check for the in-worker bulk-download zip (zip-download-batch.ts)
 * against the S3 storage of .env.local (e.g. the local SeaweedFS):
 *   npx tsx --tsconfig oss/tsconfig.jobs.json oss/features/storage/zip-download.verify.ts
 * Needs `unzip` on PATH.
 */
import { DeleteObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { PDF } from "@libpdf/core";
import { loadEnvConfig } from "@next/env";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { assert, check } from "../../jobs/testing";

loadEnvConfig(process.cwd());

async function main() {
  const { getStorageConfig } = await import("./config");
  const { getS3Client } = await import("../../../lib/files/aws-client");
  const { zipDownloadBatch } = await import("./zip-download-batch");
  const config = getStorageConfig();
  const client = getS3Client();

  const pdf = PDF.create();
  pdf.addPage({ width: 300, height: 300 });
  const pdfBytes = await pdf.save();

  const prefix = `zip-verify/${Date.now()}`;
  const objects: Record<string, Uint8Array | string> = {
    [`${prefix}/a.pdf`]: pdfBytes,
    [`${prefix}/b.txt`]: "hello zip",
    [`${prefix}/c.txt`]: "same name, other folder",
    [`${prefix}/d.txt`]: "duplicate name",
  };
  for (const [Key, Body] of Object.entries(objects)) {
    await client.send(
      new PutObjectCommand({ Bucket: config.bucket, Key, Body }),
    );
  }

  const dir = mkdtempSync(path.join(tmpdir(), "zip-verify-"));
  try {
    await check("zip has folders, empty folders, deduped names", async () => {
      const { downloadUrl } = await zipDownloadBatch({
        storageConfig: config,
        sourceBucket: config.bucket,
        zipFileName: "Q4 Room-20261118T000000Z",
        folderStructure: {
          "/": {
            name: "Root",
            path: "/",
            files: [
              {
                name: "Report.pdf",
                key: `${prefix}/a.pdf`,
                type: "pdf",
                numPages: 1,
              },
              { name: "notes.txt", key: `${prefix}/b.txt` },
              { name: "notes.txt", key: `${prefix}/d.txt` },
            ],
          },
          "/Legal/Contracts": {
            name: "Contracts",
            path: "/Legal/Contracts",
            files: [{ name: "notes.txt", key: `${prefix}/c.txt` }],
          },
          "/Empty": { name: "Empty", path: "/Empty", files: [] },
        },
      });
      const res = await fetch(downloadUrl);
      assert(res.ok, `download ${res.status}`);
      assert(
        /attachment; filename\*=UTF-8''Q4%20Room-20261118T000000Z\.zip/.test(
          res.headers.get("content-disposition") ?? "",
        ),
        `content-disposition: ${res.headers.get("content-disposition")}`,
      );
      const zip = path.join(dir, "plain.zip");
      writeFileSync(zip, Buffer.from(await res.arrayBuffer()));
      const entries = execFileSync("unzip", ["-Z1", zip])
        .toString()
        .trim()
        .split("\n")
        .sort();
      assert(
        entries.join("|") ===
          [
            "Empty/",
            "Legal/Contracts/notes.txt",
            "Report.pdf",
            "notes (2).txt",
            "notes.txt",
          ].join("|"),
        `entries: ${entries.join(", ")}`,
      );
      execFileSync("unzip", ["-q", "-o", zip, "-d", path.join(dir, "plain")]);
      assert(
        readFileSync(
          path.join(dir, "plain/Legal/Contracts/notes.txt"),
          "utf8",
        ) === "same name, other folder",
        "content round-trips",
      );
      assert(
        Buffer.compare(
          readFileSync(path.join(dir, "plain/Report.pdf")),
          Buffer.from(pdfBytes),
        ) === 0,
        "unwatermarked PDF is the original",
      );
    });

    await check("needsWatermark files are watermarked", async () => {
      const { downloadUrl } = await zipDownloadBatch({
        storageConfig: config,
        sourceBucket: config.bucket,
        zipFileName: "wm",
        watermarkConfig: {
          enabled: true,
          config: {
            text: "CONFIDENTIAL {{email}}",
            isTiled: false,
            position: "middle-center",
            rotation: 45,
            color: "#ff0000",
            fontSize: 24,
            opacity: 0.5,
          },
          viewerData: { email: "viewer@example.com" },
        },
        folderStructure: {
          "/": {
            name: "Root",
            path: "/",
            files: [
              {
                name: "Report.pdf",
                key: `${prefix}/a.pdf`,
                type: "pdf",
                numPages: 1,
                needsWatermark: true,
              },
            ],
          },
        },
      });
      const zip = path.join(dir, "wm.zip");
      writeFileSync(
        zip,
        Buffer.from(await (await fetch(downloadUrl)).arrayBuffer()),
      );
      execFileSync("unzip", ["-q", "-o", zip, "-d", path.join(dir, "wm")]);
      const out = readFileSync(path.join(dir, "wm/Report.pdf"));
      assert(out.subarray(0, 5).toString() === "%PDF-", "a PDF");
      assert(
        Buffer.compare(out, Buffer.from(pdfBytes)) !== 0,
        "changed by the watermark",
      );
      const reloaded = await PDF.load(new Uint8Array(out));
      assert(reloaded.getPageCount() === 1, "still one page");
    });

    await check("bulk download job: completes without a Lambda", async () => {
      delete process.env.NEXT_PRIVATE_DOWNLOAD_LAMBDA_FUNCTION_NAME;
      const { useIsolatedSchemas, startTestWorker, waitForStatus } =
        await import("../../jobs/testing");
      await useIsolatedSchemas("zipdownload");
      const { bulkDownloadTask } =
        await import("../../../lib/trigger/bulk-download");
      const { downloadJobStore } =
        await import("../../../lib/redis-download-job-store");
      const { destroyClient } = await import("../../jobs/client");
      const worker = await startTestWorker();
      try {
        const job = await downloadJobStore.createJob({
          type: "bulk",
          status: "PENDING",
          dataroomId: "dr_verify",
          dataroomName: "Verify Room",
          totalFiles: 1,
          processedFiles: 0,
          progress: 0,
          teamId: "team_verify",
          userId: "user_verify",
        });
        const run = await bulkDownloadTask.trigger({
          jobId: job.id,
          dataroomId: "dr_verify",
          dataroomName: "Verify Room",
          teamId: "team_verify",
          sourceBucket: config.bucket,
          fileKeys: [`${prefix}/b.txt`],
          folderStructure: {
            "/": {
              name: "Root",
              path: "/",
              files: [{ name: "notes.txt", key: `${prefix}/b.txt`, size: 9 }],
            },
          },
        });
        const status = await waitForStatus(
          run.id,
          ["COMPLETED", "FAILED"],
          60000,
        );
        assert(status === "COMPLETED", `run ${status}`);
        const done = await downloadJobStore.getJob(job.id);
        assert(done?.status === "COMPLETED", `job ${done?.status}`);
        const res = await fetch(done!.downloadUrls![0]);
        assert(res.ok, `download ${res.status}`);
        const zip = path.join(dir, "job.zip");
        writeFileSync(zip, Buffer.from(await res.arrayBuffer()));
        const entries = execFileSync("unzip", ["-Z1", zip]).toString().trim();
        assert(entries === "notes.txt", `entries: ${entries}`);
      } finally {
        await worker.stop();
        await destroyClient();
      }
    });

    await check("cleanup deletes only zips older than 4 days", async () => {
      const { deleteExpiredBulkDownloads, BULK_DOWNLOAD_PREFIX } =
        await import("./lib/trigger/cleanup-bulk-downloads");
      const { ListObjectsV2Command } = await import("@aws-sdk/client-s3");
      const list = async () =>
        (
          await client.send(
            new ListObjectsV2Command({
              Bucket: config.bucket,
              Prefix: BULK_DOWNLOAD_PREFIX,
            }),
          )
        ).Contents?.length ?? 0;
      const before = await list();
      assert(before >= 3, `zips from the checks above: ${before}`);
      assert(
        (await deleteExpiredBulkDownloads()).deleted === 0,
        "fresh zips kept",
      );
      const { deleted } = await deleteExpiredBulkDownloads(
        Date.now() + 5 * 24 * 60 * 60 * 1000,
      );
      assert(deleted === before, `deleted ${deleted} of ${before}`);
      assert((await list()) === 0, "prefix empty");
    });

    await check("a missing source object fails the batch", async () => {
      let failed = false;
      try {
        await zipDownloadBatch({
          storageConfig: config,
          sourceBucket: config.bucket,
          zipFileName: "missing",
          folderStructure: {
            "/": {
              name: "Root",
              path: "/",
              files: [{ name: "x.txt", key: `${prefix}/does-not-exist` }],
            },
          },
        });
      } catch {
        failed = true;
      }
      assert(failed, "rejects");
    });
  } finally {
    for (const Key of Object.keys(objects)) {
      await client.send(
        new DeleteObjectCommand({ Bucket: config.bucket, Key }),
      );
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
