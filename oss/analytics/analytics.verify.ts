/**
 * Runtime check for view analytics on Postgres (oss/analytics), through the
 * unchanged lib/tinybird module (aliased like the app build):
 *   npx tsx --tsconfig oss/tsconfig.jobs.json oss/analytics/analytics.verify.ts
 * Writes events with unique ids into the dev database and deletes them.
 */
import { loadEnvConfig } from "@next/env";

import { assert, check } from "../jobs/testing";

loadEnvConfig(process.cwd());

async function main() {
  const tb = await import("../../lib/tinybird");
  const { default: prisma } = await import("../../lib/prisma");
  const { SCHEMA } = await import("./store");

  const run = `v${Date.now()}`;
  const doc = `doc_${run}`;
  const dr = `dr_${run}`;
  const [linkA, linkB] = [`linkA_${run}`, `linkB_${run}`];
  const [view1, view2] = [`view1_${run}`, `view2_${run}`];
  const t0 = Date.now();
  const pv = (
    viewId: string,
    linkId: string,
    pageNumber: string,
    duration: number,
    versionNumber = 1,
  ) =>
    tb.publishPageView({
      id: `${viewId}-${pageNumber}-${duration}`,
      linkId,
      documentId: doc,
      viewId,
      dataroomId: dr,
      versionNumber,
      time: t0,
      duration,
      pageNumber,
      country: "Brazil",
      city: "Recife",
      browser: "Chrome",
      os: "macOS",
      device: "Desktop",
    });

  try {
    await check(
      "ingest: page views, link opens, clicks, video, webhooks",
      async () => {
        const r = await pv(view1, linkA, "1", 1000);
        assert(r.successful_rows === 1, "one row");
        await pv(view1, linkA, "2", 3000);
        await pv(view1, linkA, "1", 500); // same page again
        await pv(view2, linkB, "1", 2000);
        await tb.recordLinkViewTB({
          timestamp: new Date(t0).toISOString(),
          click_id: `c_${run}`,
          view_id: view1,
          link_id: linkA,
          document_id: doc,
          dataroom_id: dr,
          country: "Brazil",
          browser: "Firefox",
          ip_address: null,
        });
        await tb.recordClickEvent({
          timestamp: "2026-11-18 10:00:00.000",
          event_id: `e_${run}`,
          session_id: "s",
          link_id: linkA,
          document_id: doc,
          view_id: view1,
          page_number: "2",
          href: "https://example.com",
          version_number: 1,
          dataroom_id: null,
        });
        await tb.recordVideoView({
          timestamp: new Date(t0).toISOString(),
          id: `vv_${run}`,
          link_id: linkA,
          document_id: doc,
          view_id: view1,
          dataroom_id: null,
          version_number: 1,
          event_type: "played",
          start_time: 0,
          playback_rate: 1,
          volume: 1,
          is_muted: 0,
          is_focused: 1,
          is_fullscreen: 0,
          ip_address: null,
        });
        await tb.recordWebhookEvent({
          event_id: `evt_${run}`,
          webhook_id: `wh_${run}`,
          message_id: "m",
          event: "link.created",
          url: "https://example.com/hook",
          http_status: 200,
          request_body: "{}",
          response_body: "ok",
        });
        let threw = false;
        await tb
          .publishPageView({ linkId: linkA } as never)
          .catch(() => (threw = true));
        assert(threw, "invalid events are rejected");
      },
    );

    await check("document and link totals", async () => {
      const doc0 = await tb.getTotalDocumentDuration({
        documentId: doc,
        excludedLinkIds: "",
        excludedViewIds: "",
        since: 0,
      });
      assert(doc0.data[0].sum_duration === 6500, JSON.stringify(doc0.data));
      const docEx = await tb.getTotalDocumentDuration({
        documentId: doc,
        excludedLinkIds: linkB,
        excludedViewIds: "",
        since: 0,
      });
      assert(docEx.data[0].sum_duration === 4500, "link excluded");
      const none = await tb.getTotalDocumentDuration({
        documentId: "nothing",
        excludedLinkIds: "",
        excludedViewIds: "",
        since: 0,
      });
      assert(none.data[0].sum_duration === 0, "empty sum is 0");
      const link = await tb.getTotalLinkDuration({
        linkId: linkA,
        documentId: doc,
        excludedViewIds: "",
        since: 0,
      });
      assert(
        link.data[0].sum_duration === 4500 && link.data[0].view_count === 1,
        JSON.stringify(link.data),
      );
    });

    await check("per-page and per-view stats", async () => {
      const avg = await tb.getTotalAvgPageDuration({
        documentId: doc,
        excludedLinkIds: "",
        excludedViewIds: "",
        since: 0,
      });
      // page 1: view1 1500, view2 2000 → 1750; page 2: view1 3000
      assert(
        JSON.stringify(avg.data) ===
          JSON.stringify([
            { versionNumber: 1, pageNumber: "1", avg_duration: 1750 },
            { versionNumber: 1, pageNumber: "2", avg_duration: 3000 },
          ]),
        JSON.stringify(avg.data),
      );
      const pages = await tb.getViewPageDuration({
        documentId: doc,
        viewId: view1,
        since: 0,
      });
      assert(
        pages.data.map((p) => `${p.pageNumber}:${p.sum_duration}`).join() ===
          "1:1500,2:3000",
        JSON.stringify(pages.data),
      );
      const completion = await tb.getViewCompletionStats({
        documentId: doc,
        excludedViewIds: view2,
        since: 0,
      });
      assert(
        completion.data.length === 1 && completion.data[0].pages_viewed === 2,
        JSON.stringify(completion.data),
      );
      const viewer = await tb.getTotalViewerDuration({
        viewIds: `${view1},${view2}`,
        since: 0,
      });
      assert(viewer.data[0].sum_duration === 6500, "viewer total");
      const perViewer = await tb.getDocumentDurationPerViewer({
        documentId: doc,
        viewIds: view2,
      });
      assert(perViewer.data[0].sum_duration === 2000, "per viewer");
    });

    await check("data rooms", async () => {
      const room = await tb.getTotalDataroomDuration({
        dataroomId: dr,
        excludedLinkIds: [],
        excludedViewIds: [view2],
        since: 0,
      });
      assert(
        room.data.length === 1 && room.data[0].sum_duration === 4500,
        JSON.stringify(room.data),
      );
      const stats = await tb.getDataroomViewDocumentStats({
        viewIds: `${view1},${view2}`,
      });
      const v1 = stats.data.find((s) => s.viewId === view1);
      assert(
        v1?.sum_duration === 4500 && v1.pages_viewed === 2,
        JSON.stringify(stats.data),
      );
    });

    await check(
      "user agent, clicks, video, webhooks, team totals",
      async () => {
        const ua3 = await tb.getViewUserAgent({ viewId: view1 });
        assert(ua3.data[0]?.browser === "Firefox", JSON.stringify(ua3.data));
        const ua2 = await tb.getViewUserAgent_v2({
          documentId: doc,
          viewId: view2,
          since: 0,
        });
        assert(ua2.data[0]?.city === "Recife", JSON.stringify(ua2.data));
        const clicks = await tb.getClickEventsByView({
          document_id: doc,
          view_id: view1,
        });
        assert(
          clicks.data.length === 1 &&
            clicks.data[0].timestamp === "2026-11-18T10:00:00.000Z" &&
            clicks.data[0].href === "https://example.com",
          JSON.stringify(clicks.data),
        );
        const video = await tb.getVideoEventsByDocument({ document_id: doc });
        assert(
          video.data.length === 1 &&
            video.data[0].event_type === "played" &&
            video.data[0].end_time === 0,
          JSON.stringify(video.data),
        );
        const byView = await tb.getVideoEventsByView({
          document_id: doc,
          view_id: view1,
        });
        assert(byView.data.length === 1, "video by view");
        const hooks = await tb.getWebhookEvents({ webhookId: `wh_${run}` });
        assert(
          hooks.data.length === 1 &&
            hooks.data[0].http_status === 200 &&
            !!hooks.data[0].timestamp,
          JSON.stringify(hooks.data),
        );
        const team = await tb.getTotalTeamDuration({
          documentIds: doc,
          since: t0 - 1000,
          until: t0 + 1000,
        });
        assert(
          team.data[0].total_duration === 6500 &&
            JSON.stringify(team.data[0].unique_countries) === '["Brazil"]',
          JSON.stringify(team.data),
        );
      },
    );
  } finally {
    for (const [table, col, value] of [
      ["page_views", "document_id", doc],
      ["pm_click_events", "document_id", doc],
      ["click_events", "document_id", doc],
      ["video_views", "document_id", doc],
      ["webhook_events", "webhook_id", `wh_${run}`],
    ]) {
      await prisma.$executeRawUnsafe(
        `DELETE FROM ${SCHEMA}.${table} WHERE ${col} = $1`,
        value,
      );
    }
    await prisma.$disconnect();
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
