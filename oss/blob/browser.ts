/**
 * [fork] `@vercel/blob` in the browser build. Client code only calls
 * `getDownloadUrl` (lib/files/get-file.ts); writing needs credentials and runs
 * on the server (./server.ts).
 */
export type { PutBlobResult } from "./server";

/** Public objects are downloadable as-is (same as ./server.ts). */
export function getDownloadUrl(url: string): string {
  return url;
}

function serverOnly(name: string): never {
  throw new Error(`${name} runs on the server only`);
}

export async function put(..._args: unknown[]): Promise<never> {
  serverOnly("put");
}
export async function del(..._args: unknown[]): Promise<never> {
  serverOnly("del");
}
export async function copy(..._args: unknown[]): Promise<never> {
  serverOnly("copy");
}
