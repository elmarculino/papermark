/**
 * [fork] Storage for what upstream keeps in Vercel Blob: logos and branding
 * images, link preview images, visit exports. It lives in a public-read S3
 * bucket next to the private documents bucket and uses the same credentials.
 *
 *   NEXT_PRIVATE_UPLOAD_PUBLIC_BUCKET    bucket name (required), anonymous read
 *   NEXT_PRIVATE_UPLOAD_PUBLIC_BASE_URL  optional; default derived from the endpoint
 */
import { S3Client } from "@aws-sdk/client-s3";

export function publicBucket(): string {
  const bucket = process.env.NEXT_PRIVATE_UPLOAD_PUBLIC_BUCKET;
  if (!bucket) {
    throw new Error(
      "NEXT_PRIVATE_UPLOAD_PUBLIC_BUCKET must be set (BLOB_BACKEND=s3 stores public files there)",
    );
  }
  return bucket;
}

/** Base URL that public objects are served from, without a trailing slash. */
export function publicBaseUrl(): string {
  const explicit = process.env.NEXT_PRIVATE_UPLOAD_PUBLIC_BASE_URL;
  if (explicit) return explicit.replace(/\/+$/, "");
  const bucket = publicBucket();
  const endpoint = process.env.NEXT_PRIVATE_UPLOAD_ENDPOINT?.replace(
    /\/+$/,
    "",
  );
  if (!endpoint) {
    const region = process.env.NEXT_PRIVATE_UPLOAD_REGION || "us-east-1";
    return `https://${bucket}.s3.${region}.amazonaws.com`;
  }
  if (process.env.NEXT_PRIVATE_UPLOAD_FORCE_PATH_STYLE === "true") {
    return `${endpoint}/${bucket}`;
  }
  const url = new URL(endpoint);
  return `${url.protocol}//${bucket}.${url.host}`;
}

let client: S3Client | undefined;

export function blobS3Client(): S3Client {
  if (client) return client;
  const accessKeyId = process.env.NEXT_PRIVATE_UPLOAD_ACCESS_KEY_ID;
  const secretAccessKey = process.env.NEXT_PRIVATE_UPLOAD_SECRET_ACCESS_KEY;
  if (!accessKeyId || !secretAccessKey) {
    throw new Error(
      "NEXT_PRIVATE_UPLOAD_ACCESS_KEY_ID/SECRET_ACCESS_KEY must be set",
    );
  }
  client = new S3Client({
    endpoint: process.env.NEXT_PRIVATE_UPLOAD_ENDPOINT || undefined,
    forcePathStyle: process.env.NEXT_PRIVATE_UPLOAD_FORCE_PATH_STYLE === "true",
    region: process.env.NEXT_PRIVATE_UPLOAD_REGION || "us-east-1",
    credentials: { accessKeyId, secretAccessKey },
    // No CRC32 checksums: S3-compatible stores (SeaweedFS, MinIO) reject the
    // trailing/presigned checksum the SDK adds by default (BadDigest).
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
  });
  return client;
}

/** Object key for a URL we issued, or null for anything else. */
export function keyFromUrl(url: string): string | null {
  const base = `${publicBaseUrl()}/`;
  if (!url.startsWith(base)) return null;
  const path = url.slice(base.length).split(/[?#]/)[0];
  return path.split("/").map(decodeURIComponent).join("/");
}

export function urlForKey(key: string): string {
  return `${publicBaseUrl()}/${key.split("/").map(encodeURIComponent).join("/")}`;
}

const TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  ico: "image/x-icon",
  csv: "text/csv",
  txt: "text/plain",
  pdf: "application/pdf",
  json: "application/json",
};

export function contentTypeFor(pathname: string): string {
  const ext = pathname.split(".").pop()?.toLowerCase() ?? "";
  return TYPES[ext] ?? "application/octet-stream";
}
