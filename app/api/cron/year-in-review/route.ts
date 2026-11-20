import { NextResponse } from "next/server";

import { receiver } from "@/lib/cron";
import { log } from "@/lib/utils";
import { processEmailQueue } from "@/lib/year-in-review/send-emails";

// Runs every hour (0 * * * *)
export const maxDuration = 300; // 5 minutes in seconds

export async function POST(req: Request) {
  // [fork] Verify the raw body as signed (was: re-serialised JSON, which
  // fails for a body with whitespace), everywhere but development (was: only
  // on Vercel). A bad signature is a 401, not a thrown error.
  const body = await req.text();
  if (process.env.NODE_ENV !== "development") {
    const isValid = await receiver
      .verify({
        signature: req.headers.get("Upstash-Signature") || "",
        body,
      })
      .catch(() => false);
    if (!isValid) {
      return new Response("Unauthorized", { status: 401 });
    }
  }

  try {
    await processEmailQueue();
    return NextResponse.json({ success: true });
  } catch (error) {
    await log({
      message: `Year in review email cron failed. \n\nError: ${(error as Error).message}`,
      type: "cron",
      mention: true,
    });
    return NextResponse.json({ error: (error as Error).message });
  }
}
