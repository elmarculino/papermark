/**
 * [fork] Server half of the `@vercel/blob` replacement (aliased in
 * next.config.mjs when BLOB_BACKEND=s3, and in oss/tsconfig.jobs.json for the
 * jobs worker). Covers what Papermark calls: put, del, copy, getDownloadUrl,
 * and handleUpload for browser uploads (see ./client.ts).
 */
import {
  CopyObjectCommand,
  DeleteObjectsCommand,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { randomBytes } from "node:crypto";

import {
  blobS3Client,
  contentTypeFor,
  keyFromUrl,
  publicBucket,
  urlForKey,
} from "./config";

export type PutBody =
  | string
  | Buffer
  | Uint8Array
  | ArrayBuffer
  | Blob
  | ReadableStream;

export type PutCommandOptions = {
  access: "public" | "private";
  addRandomSuffix?: boolean;
  allowOverwrite?: boolean;
  contentType?: string;
  cacheControlMaxAge?: number;
};

export type PutBlobResult = {
  url: string;
  downloadUrl: string;
  pathname: string;
  contentType: string;
  contentDisposition: string;
};

export type CopyBlobResult = PutBlobResult;

/** `name.ext` → `name-<32 hex>.ext`, like Vercel Blob's random suffix. */
export function withRandomSuffix(pathname: string): string {
  const suffix = randomBytes(16).toString("hex");
  const slash = pathname.lastIndexOf("/");
  const dot = pathname.lastIndexOf(".");
  return dot > slash + 1
    ? `${pathname.slice(0, dot)}-${suffix}${pathname.slice(dot)}`
    : `${pathname}-${suffix}`;
}

function normalize(pathname: string): string {
  const key = pathname.replace(/^\/+/, "");
  if (!key) throw new Error("pathname is required");
  return key;
}

async function toBytes(body: PutBody): Promise<Uint8Array | string> {
  if (typeof body === "string" || body instanceof Uint8Array) return body;
  if (body instanceof ArrayBuffer) return new Uint8Array(body);
  if (typeof Blob !== "undefined" && body instanceof Blob) {
    return new Uint8Array(await body.arrayBuffer());
  }
  return new Uint8Array(
    await new Response(body as ReadableStream).arrayBuffer(),
  );
}

function result(key: string, contentType: string): PutBlobResult {
  const url = urlForKey(key);
  const name = key.split("/").pop() ?? key;
  return {
    url,
    downloadUrl: getDownloadUrl(url),
    pathname: key,
    contentType,
    contentDisposition: `attachment; filename="${name}"`,
  };
}

function cacheControl(seconds?: number): string {
  return `public, max-age=${seconds ?? 2592000}`;
}

export async function put(
  pathname: string,
  body: PutBody,
  options: PutCommandOptions,
): Promise<PutBlobResult> {
  const base = normalize(pathname);
  const key = options.addRandomSuffix ? withRandomSuffix(base) : base;
  const contentType = options.contentType || contentTypeFor(key);
  await blobS3Client().send(
    new PutObjectCommand({
      Bucket: publicBucket(),
      Key: key,
      Body: await toBytes(body),
      ContentType: contentType,
      CacheControl: cacheControl(options.cacheControlMaxAge),
    }),
  );
  return result(key, contentType);
}

/** Deletes objects we issued. Other URLs (old Vercel Blob links, local paths) are ignored. */
export async function del(urlOrPathname: string | string[]): Promise<void> {
  const keys = (Array.isArray(urlOrPathname) ? urlOrPathname : [urlOrPathname])
    .map((value) => (/^https?:\/\//.test(value) ? keyFromUrl(value) : null))
    .filter((key): key is string => !!key);
  if (keys.length === 0) return;
  await blobS3Client().send(
    new DeleteObjectsCommand({
      Bucket: publicBucket(),
      Delete: { Objects: keys.map((Key) => ({ Key })), Quiet: true },
    }),
  );
}

export async function copy(
  fromUrlOrPathname: string,
  toPathname: string,
  options: PutCommandOptions,
): Promise<CopyBlobResult> {
  const fromKey = /^https?:\/\//.test(fromUrlOrPathname)
    ? keyFromUrl(fromUrlOrPathname)
    : normalize(fromUrlOrPathname);
  if (!fromKey)
    throw new Error(`Cannot copy ${fromUrlOrPathname}: not stored here`);
  const base = normalize(toPathname);
  const key = options.addRandomSuffix ? withRandomSuffix(base) : base;
  const contentType = options.contentType || contentTypeFor(key);
  const bucket = publicBucket();
  await blobS3Client().send(
    new CopyObjectCommand({
      Bucket: bucket,
      Key: key,
      CopySource: `${bucket}/${fromKey.split("/").map(encodeURIComponent).join("/")}`,
      ContentType: contentType,
      CacheControl: cacheControl(options.cacheControlMaxAge),
      MetadataDirective: "REPLACE",
    }),
  );
  return result(key, contentType);
}

/** Public objects are downloadable as-is. */
export function getDownloadUrl(url: string): string {
  return url;
}

// ---------------------------------------------------------------------------
// Browser uploads. The client (./client.ts) asks the app's upload route for a
// token; the route calls handleUpload, which checks the request with the
// route's onBeforeGenerateToken and returns a presigned PUT for exactly that
// content type and size. The browser then PUTs straight to S3.

export type GenerateClientTokenEvent = {
  type: "blob.generate-client-token";
  payload: {
    pathname: string;
    clientPayload: string | null;
    multipart: boolean;
    contentType?: string;
    size?: number;
  };
};

export type UploadCompletedEvent = {
  type: "blob.upload-completed";
  payload: { blob: PutBlobResult; tokenPayload?: string | null };
};

export type HandleUploadBody = GenerateClientTokenEvent | UploadCompletedEvent;

export type GenerateClientTokenOptions = {
  allowedContentTypes?: string[];
  maximumSizeInBytes?: number;
  addRandomSuffix?: boolean;
  allowOverwrite?: boolean;
  cacheControlMaxAge?: number;
  tokenPayload?: string | null;
  metadata?: string;
  validUntil?: number;
};

export type HandleUploadOptions = {
  body: HandleUploadBody;
  request: unknown;
  token?: string;
  onBeforeGenerateToken: (
    pathname: string,
    clientPayload: string | null,
    multipart: boolean,
  ) => Promise<GenerateClientTokenOptions>;
  onUploadCompleted?: (body: UploadCompletedEvent["payload"]) => Promise<void>;
};

/** What the client receives in `clientToken` (a JSON string). */
export type S3ClientToken = {
  uploadUrl: string;
  contentType: string;
  blob: PutBlobResult;
};

function typeAllowed(type: string, allowed?: string[]): boolean {
  if (!allowed || allowed.length === 0) return true;
  return allowed.some((pattern) =>
    pattern.endsWith("/*")
      ? type.startsWith(pattern.slice(0, -1))
      : type === pattern,
  );
}

export async function handleUpload(
  options: HandleUploadOptions,
): Promise<
  | { type: "blob.generate-client-token"; clientToken: string }
  | { type: "blob.upload-completed"; response: "ok" }
> {
  const { body } = options;
  if (body?.type === "blob.upload-completed") {
    // Not reported by S3; nothing upstream relies on it.
    return { type: "blob.upload-completed", response: "ok" };
  }
  if (body?.type !== "blob.generate-client-token") {
    throw new Error("Invalid upload request");
  }
  const { pathname, clientPayload, multipart, contentType, size } =
    body.payload;
  const rules = await options.onBeforeGenerateToken(
    pathname,
    clientPayload ?? null,
    !!multipart,
  );
  const type = contentType || contentTypeFor(pathname);
  if (!typeAllowed(type, rules.allowedContentTypes)) {
    throw new Error(`The content type ${type} is not allowed`);
  }
  if (typeof size !== "number" || !Number.isFinite(size) || size < 0) {
    throw new Error("The upload size is required");
  }
  if (
    rules.maximumSizeInBytes !== undefined &&
    size > rules.maximumSizeInBytes
  ) {
    throw new Error(
      `The file is too large (${size} bytes, limit ${rules.maximumSizeInBytes})`,
    );
  }
  const base = normalize(pathname);
  const key = rules.addRandomSuffix ? withRandomSuffix(base) : base;
  const uploadUrl = await getSignedUrl(
    blobS3Client(),
    new PutObjectCommand({
      Bucket: publicBucket(),
      Key: key,
      ContentType: type,
      ContentLength: size,
      CacheControl: cacheControl(rules.cacheControlMaxAge),
    }),
    { expiresIn: 600 },
  );
  const token: S3ClientToken = {
    uploadUrl,
    contentType: type,
    blob: result(key, type),
  };
  return {
    type: "blob.generate-client-token",
    clientToken: JSON.stringify(token),
  };
}
