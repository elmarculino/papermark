/**
 * Internal routes (mupdf, jobs, revalidate) must refuse a request without a
 * token when INTERNAL_API_KEY / REVALIDATE_TOKEN is unset (undefined !==
 * undefined used to let it through). Run against a dev server started with
 * both empty:
 *   INTERNAL_API_KEY= REVALIDATE_TOKEN= npx next dev -p 3011
 *   BASE_URL=http://localhost:3011 npx tsx oss/_shared/internal-routes.verify.ts
 */
import { assert, check } from "../jobs/testing";

const BASE = process.env.BASE_URL || "http://localhost:3011";
const ROUTES = [
  "/api/mupdf/get-pages",
  "/api/mupdf/convert-page",
  "/api/mupdf/annotate-document",
  "/api/jobs/process-download-batch",
  "/api/jobs/send-notification",
  "/api/jobs/send-dataroom-new-document-notification",
  "/api/jobs/send-dataroom-upload-notification",
];

async function main() {
  for (const route of ROUTES) {
    await check(`${route}: no key configured, no token → 401`, async () => {
      const res = await fetch(BASE + route, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: "http://127.0.0.1:9/x" }),
      });
      assert(res.status === 401, `answered ${res.status}`);
    });
  }
  await check(
    "/api/revalidate: no token configured, no secret → 401",
    async () => {
      const res = await fetch(`${BASE}/api/revalidate?path=/`);
      assert(res.status === 401, `answered ${res.status}`);
    },
  );
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
