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
  const { zipDownloadBatch: batch } = await import("./zip-download-batch");
  const config = getStorageConfig();
  const client = getS3Client();

  // Every zip a check makes is deleted at the end; nothing else under
  // bulk-downloads/ is touched (the bucket may hold real users' zips).
  const zipKeys = new Set<string>();
  const keyOf = (url: string) => {
    const p = decodeURIComponent(new URL(url).pathname);
    return p.slice(p.indexOf("bulk-downloads/"));
  };
  const zipDownloadBatch: typeof batch = async (params) => {
    const result = await batch(params);
    zipKeys.add(keyOf(result.downloadUrl));
    return result;
  };

  const pdf = PDF.create();
  pdf.addPage({ width: 300, height: 300 });
  const pdfBytes = await pdf.save();

  const prefix = `zip-verify/${Date.now()}`;
  const objects: Record<string, Uint8Array | string | Buffer> = {
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
              { name: "Contrato: minuta.txt", key: `${prefix}/b.txt` },
              { name: "http://example.com/x.txt", key: `${prefix}/b.txt` },
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
        /^attachment; filename="[^"]+\.zip"; filename\*=UTF-8''Q4%20Room-20261118T000000Z\.zip$/.test(
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
            "Contrato_ minuta.txt",
            "Empty/",
            "Legal/Contracts/notes.txt",
            "Report.pdf",
            "http___example.com_x.txt",
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
        zipKeys.add(keyOf(done!.downloadUrls![0]));
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
      // A prefix of its own: real zips in the bucket are never swept.
      const own = `${BULK_DOWNLOAD_PREFIX}verify-${Date.now()}/`;
      for (const name of ["a.zip", "b.zip", "c.zip"]) {
        await client.send(
          new PutObjectCommand({
            Bucket: config.bucket,
            Key: `${own}${name}`,
            Body: "zip",
          }),
        );
      }
      const list = async () =>
        (
          await client.send(
            new ListObjectsV2Command({ Bucket: config.bucket, Prefix: own }),
          )
        ).Contents?.length ?? 0;
      assert((await list()) === 3, "three zips");
      assert(
        (await deleteExpiredBulkDownloads({ prefix: own })).deleted === 0,
        "fresh zips kept",
      );
      const { deleted } = await deleteExpiredBulkDownloads({
        prefix: own,
        now: Date.now() + 5 * 24 * 60 * 60 * 1000,
      });
      assert(deleted === 3, `deleted ${deleted} of 3`);
      assert((await list()) === 0, "prefix empty");
      let refused = false;
      await deleteExpiredBulkDownloads({ prefix: "zip-verify/" }).catch(
        () => (refused = true),
      );
      assert(refused, "a prefix outside bulk-downloads/ is refused");
    });

    await check(
      "cleanup fails when S3 reports objects not deleted",
      async () => {
        const { deleteExpiredBulkDownloads, BULK_DOWNLOAD_PREFIX } =
          await import("./lib/trigger/cleanup-bulk-downloads");
        const { S3Client } = await import("@aws-sdk/client-s3");
        const own = `${BULK_DOWNLOAD_PREFIX}verify-${Date.now()}-errors/`;
        const Key = `${own}stuck.zip`;
        await client.send(
          new PutObjectCommand({ Bucket: config.bucket, Key, Body: "zip" }),
        );
        const realSend = S3Client.prototype.send;
        (S3Client.prototype as any).send = function (
          command: any,
          ...rest: any[]
        ) {
          if (command?.constructor?.name === "DeleteObjectsCommand") {
            return Promise.resolve({
              Deleted: [],
              Errors: [{ Key, Code: "AccessDenied", Message: "denied" }],
            });
          }
          return realSend.call(this, command, ...rest);
        };
        let error: unknown;
        try {
          await deleteExpiredBulkDownloads({
            prefix: own,
            now: Date.now() + 5 * 24 * 60 * 60 * 1000,
          });
        } catch (e) {
          error = e;
        } finally {
          (S3Client.prototype as any).send = realSend;
          await client.send(
            new DeleteObjectCommand({ Bucket: config.bucket, Key }),
          );
        }
        assert(String(error).includes("AccessDenied"), `rejects: ${error}`);
      },
    );

    await check(
      "the download names a room with quotes and brackets correctly",
      async () => {
        const name = "Sala d'Ana (2026) *final*";
        const { downloadUrl } = await zipDownloadBatch({
          storageConfig: config,
          sourceBucket: config.bucket,
          zipFileName: name,
          folderStructure: {
            "/": {
              name: "Root",
              path: "/",
              files: [{ name: "b.txt", key: `${prefix}/b.txt` }],
            },
          },
        });
        const res = await fetch(downloadUrl);
        assert(res.ok, `download ${res.status}`);
        await res.arrayBuffer();
        const header = res.headers.get("content-disposition") ?? "";
        const star = header.match(/filename\*=UTF-8''([^;\s]+)/)?.[1] ?? "";
        // RFC 5987 attr-chars only, and it decodes back to the name.
        assert(/^[A-Za-z0-9%!#$&+.^_`|~-]+$/.test(star), `filename*: ${star}`);
        assert(decodeURIComponent(star) === `${name}.zip`, header);
        assert(/filename="[^"]+\.zip"/.test(header), `fallback: ${header}`);
      },
    );

    await check(
      "a source stream closing early without an error rejects",
      async () => {
        const { S3Client } = await import("@aws-sdk/client-s3");
        const { Readable } = await import("node:stream");
        const realSend = S3Client.prototype.send;
        (S3Client.prototype as any).send = function (
          command: any,
          ...rest: any[]
        ) {
          if (command?.input?.Key === `${prefix}/closing`) {
            let sent = false;
            const body = new Readable({
              read() {
                if (sent) return;
                sent = true;
                this.push(Buffer.alloc(1000, 1));
                // A dropped connection: closed, no 'end', no 'error'.
                setTimeout(() => this.destroy(), 300);
              },
            });
            return Promise.resolve({ Body: body });
          }
          return realSend.call(this, command, ...rest);
        };
        const started = Date.now();
        let error: unknown;
        try {
          await Promise.race([
            zipDownloadBatch({
              storageConfig: config,
              sourceBucket: config.bucket,
              zipFileName: "closing",
              folderStructure: {
                "/": {
                  name: "Root",
                  path: "/",
                  files: [{ name: "c.bin", key: `${prefix}/closing` }],
                },
              },
            }),
            new Promise((_, reject) =>
              setTimeout(() => reject(new Error("hung")), 20000),
            ),
          ]);
        } catch (e) {
          error = e;
        } finally {
          (S3Client.prototype as any).send = realSend;
        }
        assert(
          error && /premature close/i.test(String(error)),
          `rejects: ${error}`,
        );
        assert(Date.now() - started < 20000, "no hang");
      },
    );

    await check(
      "watermarked entries then plain ones; images become .pdf",
      async () => {
        const png = Buffer.from(
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
          "base64",
        );
        await client.send(
          new PutObjectCommand({
            Bucket: config.bucket,
            Key: `${prefix}/p.png`,
            Body: png,
          }),
        );
        objects[`${prefix}/p.png`] = png;
        const wm = {
          enabled: true,
          config: {
            text: "CONFIDENTIAL",
            isTiled: false,
            position: "middle-center",
            rotation: 0,
            color: "#ff0000",
            fontSize: 12,
            opacity: 0.5,
          },
          viewerData: {},
        };
        const { downloadUrl } = await zipDownloadBatch({
          storageConfig: config,
          sourceBucket: config.bucket,
          zipFileName: "mixed",
          watermarkConfig: wm,
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
                {
                  name: "Photo.png",
                  key: `${prefix}/p.png`,
                  type: "image",
                  needsWatermark: true,
                },
                { name: "notes.txt", key: `${prefix}/b.txt` },
              ],
            },
            "/Empty": { name: "Empty", path: "/Empty", files: [] },
          },
        });
        const zip = path.join(dir, "mixed.zip");
        writeFileSync(
          zip,
          Buffer.from(await (await fetch(downloadUrl)).arrayBuffer()),
        );
        const entries = execFileSync("unzip", ["-Z1", zip])
          .toString()
          .trim()
          .split("\n")
          .sort();
        assert(
          entries.join("|") === "Empty/|Photo.pdf|Report.pdf|notes.txt",
          `entries: ${entries.join(", ")}`,
        );
        execFileSync("unzip", ["-q", "-o", zip, "-d", path.join(dir, "mixed")]);
        assert(
          readFileSync(path.join(dir, "mixed/Photo.pdf"))
            .subarray(0, 5)
            .toString() === "%PDF-",
          "watermarked image is a PDF",
        );
      },
    );

    await check(
      "a source stream failing mid-read rejects and leaves no upload",
      async () => {
        const { S3Client, ListMultipartUploadsCommand } =
          await import("@aws-sdk/client-s3");
        const { Readable } = await import("node:stream");
        const { randomBytes } = await import("node:crypto");
        const big = randomBytes(6 * 1024 * 1024); // > 5 MB: a multipart upload is open
        await client.send(
          new PutObjectCommand({
            Bucket: config.bucket,
            Key: `${prefix}/big.bin`,
            Body: big,
          }),
        );
        objects[`${prefix}/big.bin`] = "";
        const realSend = S3Client.prototype.send;
        (S3Client.prototype as any).send = function (
          command: any,
          ...rest: any[]
        ) {
          if (command?.input?.Key === `${prefix}/erroring`) {
            let sent = false;
            const body = new Readable({
              read() {
                if (sent) return;
                sent = true;
                this.push(Buffer.alloc(1000, 1));
                setTimeout(() => this.destroy(new Error("ECONNRESET")), 300);
              },
            });
            return Promise.resolve({ Body: body });
          }
          return realSend.call(this, command, ...rest);
        };
        const started = Date.now();
        let error: unknown;
        try {
          await zipDownloadBatch({
            storageConfig: config,
            sourceBucket: config.bucket,
            zipFileName: "broken",
            watermarkConfig: {
              enabled: true,
              config: {
                text: "X",
                isTiled: false,
                position: "middle-center",
                rotation: 0,
                color: "#000000",
                fontSize: 12,
                opacity: 0.5,
              },
              viewerData: {},
            },
            folderStructure: {
              "/": {
                name: "Root",
                path: "/",
                files: [
                  { name: "big.bin", key: `${prefix}/big.bin` },
                  {
                    name: "Report.pdf",
                    key: `${prefix}/a.pdf`,
                    type: "pdf",
                    numPages: 1,
                    needsWatermark: true,
                  },
                  { name: "doc.docx", key: `${prefix}/erroring` },
                  { name: "after.txt", key: `${prefix}/b.txt` },
                ],
              },
            },
          });
        } catch (e) {
          error = e;
        } finally {
          (S3Client.prototype as any).send = realSend;
        }
        assert(
          error && String(error).includes("ECONNRESET"),
          `rejects: ${error}`,
        );
        assert(Date.now() - started < 30000, "no hang");
        const uploads = await client.send(
          new ListMultipartUploadsCommand({
            Bucket: config.bucket,
            Prefix: "bulk-downloads/",
          }),
        );
        const open = (uploads.Uploads ?? []).filter(
          (u) =>
            u.Key?.endsWith("/broken.zip") &&
            (u.Initiated?.getTime() ?? 0) >= started - 1000,
        );
        assert(open.length === 0, `open multipart uploads: ${open.length}`);
      },
    );

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
    for (const Key of [...Object.keys(objects), ...zipKeys]) {
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
