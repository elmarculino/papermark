/**
 * Runtime check for the S3-backed `@vercel/blob` replacement. Needs the S3
 * env from .env.local (NEXT_PRIVATE_UPLOAD_*), e.g. the local SeaweedFS:
 *   npx tsx --tsconfig oss/tsconfig.jobs.json oss/blob/blob.verify.ts
 */
import { CreateBucketCommand } from "@aws-sdk/client-s3";
import { loadEnvConfig } from "@next/env";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

import { assert, check, throwsWith } from "../jobs/testing";

loadEnvConfig(process.cwd());
process.env.NEXT_PRIVATE_UPLOAD_PUBLIC_BUCKET = "papermark-public-verify";

async function main() {
  const { blobS3Client, publicBaseUrl } = await import("./config");
  const { put, del, copy, getDownloadUrl, handleUpload } =
    await import("./server");
  const { upload } = await import("./client");

  await blobS3Client()
    .send(new CreateBucketCommand({ Bucket: "papermark-public-verify" }))
    .catch(() => {});

  const base = publicBaseUrl();
  const png = Buffer.from("not-really-a-png");

  await check(
    "put with a random suffix serves the object publicly",
    async () => {
      const blob = await put("logos/acme logo.png", png, {
        access: "public",
        addRandomSuffix: true,
        contentType: "image/png",
      });
      assert(blob.url.startsWith(`${base}/logos/`), blob.url);
      assert(/acme%20logo-[0-9a-f]{32}\.png$/.test(blob.url), blob.url);
      assert(blob.pathname.startsWith("logos/acme logo-"), blob.pathname);
      const res = await fetch(blob.url);
      assert(res.status === 200, `GET ${res.status}`);
      assert(res.headers.get("content-type") === "image/png", "content-type");
      assert(Buffer.from(await res.arrayBuffer()).equals(png), "body");
    },
  );

  await check("put without a suffix keeps the pathname", async () => {
    const a = await put("fixed/name.txt", "one", { access: "public" });
    const b = await put("fixed/name.txt", "two", { access: "public" });
    assert(a.url === b.url && a.url === `${base}/fixed/name.txt`, a.url);
    assert((await (await fetch(b.url)).text()) === "two", "overwritten");
  });

  await check("put infers the content type from the extension", async () => {
    const blob = await put("exports/visits.csv", "a,b\n1,2\n", {
      access: "public",
      addRandomSuffix: true,
    });
    const res = await fetch(blob.url);
    assert(res.headers.get("content-type")?.startsWith("text/csv"), "csv");
  });

  await check("copy, getDownloadUrl and del", async () => {
    const src = await put("copy/src.png", png, { access: "public" });
    const dst = await copy(src.url, "copy/dst.png", { access: "public" });
    assert(dst.url === `${base}/copy/dst.png`, dst.url);
    assert((await fetch(dst.url)).status === 200, "copied");
    assert((await fetch(getDownloadUrl(dst.url))).status === 200, "download");
    await del([src.url, dst.url]);
    assert((await fetch(src.url)).status !== 200, "src deleted");
    assert((await fetch(dst.url)).status !== 200, "dst deleted");
  });

  await check("del ignores URLs that are not ours", async () => {
    await del("https://example.com/not-ours.png");
    await del("/local/path.png");
  });

  // A tiny stand-in for pages/api/file/image-upload.ts.
  const server = createServer(async (req, res) => {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    try {
      const json = await handleUpload({
        body: JSON.parse(raw),
        request: req,
        onBeforeGenerateToken: async (pathname) => {
          if (pathname.startsWith("deny")) throw new Error("Unauthorized");
          return {
            addRandomSuffix: true,
            allowedContentTypes: ["image/png", "image/svg+xml"],
            maximumSizeInBytes: 64,
          };
        },
        onUploadCompleted: async () => {},
      });
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(json));
    } catch (error) {
      res.writeHead(400, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: (error as Error).message }));
    }
  });
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const uploadUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/up`;

  try {
    await check(
      "browser upload: token, presigned PUT, public URL",
      async () => {
        const file = new Blob([png], { type: "image/png" });
        const blob = await upload("pic.png", file, {
          access: "public",
          handleUploadUrl: uploadUrl,
        });
        assert(/\/pic-[0-9a-f]{32}\.png$/.test(blob.url), blob.url);
        const res = await fetch(blob.url);
        assert(res.status === 200, `GET ${res.status}`);
        assert(Buffer.from(await res.arrayBuffer()).equals(png), "body");
      },
    );

    await check("browser upload rejects a disallowed type", async () => {
      const file = new Blob(["x"], { type: "text/html" });
      await throwsWith(
        () =>
          upload("x.html", file, {
            access: "public",
            handleUploadUrl: uploadUrl,
          }),
        "content type",
      );
    });

    await check(
      "browser upload rejects a file over the size limit",
      async () => {
        const file = new Blob([Buffer.alloc(65)], { type: "image/png" });
        await throwsWith(
          () =>
            upload("big.png", file, {
              access: "public",
              handleUploadUrl: uploadUrl,
            }),
          "too large",
        );
      },
    );

    await check(
      "browser upload surfaces onBeforeGenerateToken errors",
      async () => {
        const file = new Blob([png], { type: "image/png" });
        await throwsWith(
          () =>
            upload("deny.png", file, {
              access: "public",
              handleUploadUrl: uploadUrl,
            }),
          "Unauthorized",
        );
      },
    );
  } finally {
    server.close();
  }

  console.log("blob.verify: all checks passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
