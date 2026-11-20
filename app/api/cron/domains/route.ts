import { NextResponse } from "next/server";

import { receiver } from "@/lib/cron";
import {
  getConfigResponse,
  getDomainResponse,
  verifyDomain,
} from "@/lib/domains";
import prisma from "@/lib/prisma";
import { log } from "@/lib/utils";

import { handleDomainUpdates } from "./utils";

/**
 * Cron to check if domains are verified.
 * If a domain is invalid for more than 14 days, we send a reminder email to the owner.
 * If a domain is invalid for more than 28 days, we send a second and final reminder email to the owner.
 * If a domain is invalid for more than 30 days, we delete it from the database.
 **/
// Runs once per day at 12pm (0 12 * * *)

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
    const domains = await prisma.domain.findMany({
      where: {
        slug: {
          not: {
            in: ["papermark.io", "papermark.com"],
          },
        },
      },
      select: {
        slug: true,
        verified: true,
        createdAt: true,
        userId: true,
        teamId: true,
        _count: {
          select: {
            links: true,
          },
        },
      },
      orderBy: {
        lastChecked: "asc", // earliest first
      },
    });

    const results = await Promise.allSettled(
      domains.map(async (domain) => {
        const { slug, verified, createdAt, _count } = domain;
        const [domainJson, configJson] = await Promise.all([
          getDomainResponse(slug),
          getConfigResponse(slug),
        ]);

        let newVerified;

        if (domainJson?.error?.code === "not_found") {
          newVerified = false;
        } else if (!domainJson.verified) {
          const verificationJson = await verifyDomain(slug);
          if (verificationJson && verificationJson.verified) {
            newVerified = true;
          } else {
            newVerified = false;
          }
        } else if (!configJson.misconfigured) {
          newVerified = true;
        } else {
          newVerified = false;
        }

        const prismaResponse = await prisma.domain.update({
          where: {
            slug,
          },
          data: {
            verified: newVerified,
            lastChecked: new Date(),
          },
        });

        const changed = newVerified !== verified;

        const updates = await handleDomainUpdates({
          domain: slug,
          createdAt,
          verified: newVerified,
          changed,
          linksCount: _count.links,
        });

        return {
          domain,
          previousStatus: verified,
          currentStatus: newVerified,
          changed,
          updates,
          prismaResponse,
        };
      }),
    );
    return NextResponse.json(results);
  } catch (error) {
    await log({
      message: `Domains cron failed. \n\nError: ${(error as Error).message}`,
      type: "cron",
      mention: true,
    });
    return NextResponse.json({ error: (error as Error).message });
  }
}
