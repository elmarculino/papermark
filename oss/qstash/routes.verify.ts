/**
 * The QStash-called routes must refuse unsigned requests on a self-hosted
 * production install (VERCEL unset, NODE_ENV=production):
 *   NODE_ENV=production npx tsx --tsconfig oss/tsconfig.jobs.json oss/qstash/routes.verify.ts
 * Each handler is called with an unsigned POST; none may answer 2xx.
 */
import { loadEnvConfig } from "@next/env";

import { assert, check } from "../jobs/testing";

loadEnvConfig(process.cwd());
delete process.env.VERCEL;

const ROUTES = [
  "app/api/cron/welcome-user/route",
  "app/api/webhooks/callback/route",
  "app/api/cron/dataroom-digest/daily/route",
  "app/api/cron/dataroom-digest/weekly/route",
  "app/api/cron/year-in-review/route",
  "app/api/cron/domains/route",
];

async function main() {
  assert(process.env.NODE_ENV === "production", "run with NODE_ENV=production");
  for (const route of ROUTES) {
    await check(`${route}: unsigned POST refused`, async () => {
      const { POST } = await import(`../../${route}`);
      const req = new Request(
        `http://localhost/${route.replace(/^app\/|\/route$/g, "")}?webhookId=wh&eventId=evt&event=link.viewed`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ userId: "nobody" }),
        },
      );
      let status: number;
      try {
        status = (await POST(req)).status;
      } catch {
        status = 500; // thrown before any work: Next answers 500
      }
      assert(status >= 400, `answered ${status}`);
    });
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
