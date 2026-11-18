/**
 * [fork] Browser half of `@vercel/blob/client`: `upload` asks the app's upload
 * route (`handleUploadUrl`) for a presigned PUT and sends the file straight to
 * S3. Type-only imports from ./server, so no server code reaches the browser.
 */
import type {
  HandleUploadBody,
  HandleUploadOptions,
  PutBlobResult,
  S3ClientToken,
} from "./server";

export type { HandleUploadBody, PutBlobResult };

export type UploadOptions = {
  access: "public" | "private";
  handleUploadUrl: string;
  clientPayload?: string;
  contentType?: string;
  multipart?: boolean;
};

async function errorMessage(res: Response): Promise<string> {
  try {
    const json = await res.json();
    return json?.error || json?.message || `HTTP ${res.status}`;
  } catch {
    return `HTTP ${res.status}`;
  }
}

export async function upload(
  pathname: string,
  body: Blob,
  options: UploadOptions,
): Promise<PutBlobResult> {
  const contentType =
    options.contentType || body.type || "application/octet-stream";
  const tokenRes = await fetch(options.handleUploadUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      type: "blob.generate-client-token",
      payload: {
        pathname,
        clientPayload: options.clientPayload ?? null,
        multipart: !!options.multipart,
        contentType,
        size: body.size,
      },
    } satisfies HandleUploadBody),
  });
  if (!tokenRes.ok) throw new Error(await errorMessage(tokenRes));
  const { clientToken } = (await tokenRes.json()) as { clientToken?: string };
  if (!clientToken) throw new Error("The upload route returned no token");
  const token = JSON.parse(clientToken) as S3ClientToken;

  const putRes = await fetch(token.uploadUrl, {
    method: "PUT",
    headers: { "content-type": token.contentType },
    body,
  });
  if (!putRes.ok) {
    throw new Error(`Upload to storage failed (HTTP ${putRes.status})`);
  }
  return token.blob;
}
