// [fork] Passkey login, step 1: a one-time WebAuthn challenge (oss/passkeys).
import { NextApiRequest, NextApiResponse } from "next";

import { startPasskeyLogin } from "@/ee/passkeys/server";

import { ratelimit } from "@/lib/redis";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== "POST") {
    res.setHeader("Allow", ["POST"]);
    return res.status(405).json({ error: "Method not allowed" });
  }
  if (process.env.PASSKEY_LOGIN === "false") {
    return res.status(404).json({ error: "Passkey sign-in is disabled" });
  }
  const ip =
    (req.headers["x-forwarded-for"] as string | undefined)
      ?.split(",")[0]
      ?.trim() ||
    req.socket.remoteAddress ||
    "unknown";
  const { success } = await ratelimit(20, "1 m").limit(`passkey-auth:${ip}`);
  if (!success) return res.status(429).json({ error: "Too many requests" });

  return res.status(200).json(await startPasskeyLogin());
}
