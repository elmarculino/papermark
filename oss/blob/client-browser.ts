/**
 * [fork] `@vercel/blob/client` in the browser build: only `upload`. The
 * route-side `handleUpload` needs the AWS SDK and Node, so it stays out.
 */
import type { HandleUploadOptions } from "./server";

export { upload, type UploadOptions } from "./upload";
export type { HandleUploadBody, PutBlobResult } from "./server";

export async function handleUpload(
  _options: HandleUploadOptions,
): Promise<never> {
  throw new Error("handleUpload runs on the server only");
}
