/**
 * Runtime check for single-region S3 storage against any S3-compatible endpoint:
 *   NEXT_PUBLIC_UPLOAD_TRANSPORT=s3 NEXT_PRIVATE_UPLOAD_ENDPOINT=http://127.0.0.1:9000 \
 *   NEXT_PRIVATE_UPLOAD_FORCE_PATH_STYLE=true NEXT_PRIVATE_UPLOAD_BUCKET=... \
 *   NEXT_PRIVATE_UPLOAD_ACCESS_KEY_ID=... NEXT_PRIVATE_UPLOAD_SECRET_ACCESS_KEY=... \
 *   npx tsx oss/features/storage/storage.verify.ts
 */
import {
  getStorageConfig,
  getTeamStorageConfigById,
} from "@/ee/features/storage/config";
import { MultiRegionS3Store } from "@/ee/features/storage/s3-store";
import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import { Upload } from "@tus/utils";
import { Readable } from "node:stream";

import { getS3Client, getTeamS3ClientAndConfig } from "@/lib/files/aws-client";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function main() {
  // A distribution host without CloudFront keys (e.g. a plain S3 host for next.config)
  // must not switch downloads to CloudFront signing.
  const saved = { ...process.env };
  process.env.NEXT_PRIVATE_UPLOAD_DISTRIBUTION_HOST = "bucket.s3.example.com";
  delete process.env.NEXT_PRIVATE_UPLOAD_DISTRIBUTION_KEY_ID;
  delete process.env.NEXT_PRIVATE_UPLOAD_DISTRIBUTION_KEY_CONTENTS;
  assert(
    getStorageConfig().distributionHost === undefined,
    "no CloudFront keys -> no distributionHost",
  );
  process.env.NEXT_PRIVATE_UPLOAD_DISTRIBUTION_KEY_ID = "KID";
  process.env.NEXT_PRIVATE_UPLOAD_DISTRIBUTION_KEY_CONTENTS = "PEM";
  assert(
    getStorageConfig().distributionHost === "bucket.s3.example.com",
    "CloudFront keys -> distributionHost",
  );
  process.env = saved;

  const config = getStorageConfig();
  assert(
    config.forcePathStyle ===
      (process.env.NEXT_PRIVATE_UPLOAD_FORCE_PATH_STYLE === "true"),
    "forcePathStyle from env",
  );
  assert(
    (await getTeamStorageConfigById("any-team")).bucket === config.bucket,
    "every team shares one bucket",
  );

  const client = getS3Client();
  await client
    .send(new CreateBucketCommand({ Bucket: config.bucket }))
    .catch((error) => {
      if (!/BucketAlready/.test(String(error?.name))) throw error;
    });

  // Plain put/get through the AGPL aws-client (which now passes forcePathStyle).
  const key = `team-verify/doc-verify/hello-${Date.now()}.txt`;
  await client.send(
    new PutObjectCommand({
      Bucket: config.bucket,
      Key: key,
      Body: "hello storage",
    }),
  );
  const { client: teamClient } = await getTeamS3ClientAndConfig("team-verify");
  const got = await teamClient.send(
    new GetObjectCommand({ Bucket: config.bucket, Key: key }),
  );
  assert(
    (await got.Body!.transformToString()) === "hello storage",
    "object round-trips",
  );
  await client.send(
    new DeleteObjectCommand({ Bucket: config.bucket, Key: key }),
  );

  // Resumable upload through the tus datastore the upload routes use.
  const store = new MultiRegionS3Store();
  const body = Buffer.alloc(6 * 1024 * 1024, "a"); // > 5 MiB: exercises multipart
  const id = `team-verify/doc-verify/tus-${Date.now()}.bin`;
  await store.create(
    new Upload({ id, size: body.length, offset: 0, metadata: {} }),
  );
  const written = await store.write(Readable.from(body), id, 0);
  assert(
    written === body.length,
    `tus wrote ${written} of ${body.length} bytes`,
  );
  const upload = await store.getUpload(id);
  assert(upload.offset === body.length, "tus upload is complete");
  const object = await client.send(
    new GetObjectCommand({ Bucket: config.bucket, Key: id }),
  );
  assert(
    object.ContentLength === body.length,
    "tus upload landed as one object",
  );
  await client.send(
    new DeleteObjectCommand({ Bucket: config.bucket, Key: id }),
  );

  console.log("storage.verify: ok");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
