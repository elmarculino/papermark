/**
 * [fork] `@vercel/blob/client` replacement for server builds, the jobs worker
 * and type checks: `upload` (./upload.ts) plus the route-side `handleUpload`.
 * The browser build gets ./client-browser.ts instead (next.config.mjs).
 */
export { upload, type UploadOptions } from "./upload";
export {
  handleUpload,
  type HandleUploadBody,
  type HandleUploadOptions,
  type PutBlobResult,
} from "./server";
