/**
 * [fork] The Tinybird pipes (lib/tinybird/endpoints/*.pipe, versions as named
 * in lib/tinybird/pipes.ts) as Postgres queries over oss/analytics/store.ts.
 * Keyed by pipe name without the version suffix. Aggregates are cast to
 * float8/int so results are plain numbers, and empty sums are 0 as in
 * ClickHouse.
 */
import { SCHEMA, query } from "./store";

type Params = Record<string, any>;
const T = (name: string) => `${SCHEMA}.${name}`;
const csv = (value: unknown): string[] => String(value ?? "").split(",");
const arr = (value: unknown): string[] =>
  Array.isArray(value) ? value.map(String) : csv(value);
const UNTIL = 9999999999999;
const ts = (col = "ts") =>
  `to_char(${col} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;

export const PIPES: Record<string, (p: Params) => Promise<Params[]>> = {
  get_total_average_page_duration: (p) =>
    query(
      `WITH d AS (
         SELECT version_number, page_number, view_id, SUM(duration) AS dd
         FROM ${T("page_views")}
         WHERE document_id = $1 AND time >= $2 AND time <= $3
           AND NOT (link_id = ANY($4::text[])) AND NOT (view_id = ANY($5::text[]))
         GROUP BY 1, 2, 3)
       SELECT version_number AS "versionNumber", page_number AS "pageNumber",
              AVG(dd)::float8 AS avg_duration
       FROM d GROUP BY 1, 2 ORDER BY 1, 2`,
      p.documentId,
      p.since,
      p.until ?? UNTIL,
      csv(p.excludedLinkIds),
      csv(p.excludedViewIds),
    ),

  get_page_duration_per_view: (p) =>
    query(
      `SELECT page_number AS "pageNumber", SUM(duration)::float8 AS sum_duration
       FROM ${T("page_views")}
       WHERE document_id = $1 AND view_id = $2 AND time >= $3 AND time <= $4
       GROUP BY 1 ORDER BY 1`,
      p.documentId,
      p.viewId,
      p.since,
      p.until ?? UNTIL,
    ),

  get_view_completion_stats: (p) =>
    query(
      `SELECT view_id AS "viewId", version_number AS "versionNumber",
              COUNT(DISTINCT page_number)::int AS pages_viewed
       FROM ${T("page_views")}
       WHERE document_id = $1 AND NOT (view_id = ANY($2::text[])) AND time >= $3
       GROUP BY 1, 2`,
      p.documentId,
      csv(p.excludedViewIds),
      p.since,
    ),

  get_total_document_duration: (p) =>
    query(
      `SELECT COALESCE(SUM(duration), 0)::float8 AS sum_duration
       FROM ${T("page_views")}
       WHERE document_id = $1 AND time >= $2 AND time <= $3
         AND NOT (link_id = ANY($4::text[])) AND NOT (view_id = ANY($5::text[]))`,
      p.documentId,
      p.since,
      p.until ?? UNTIL,
      csv(p.excludedLinkIds),
      csv(p.excludedViewIds),
    ),

  get_total_link_duration: (p) =>
    query(
      `SELECT COALESCE(SUM(duration), 0)::float8 AS sum_duration,
              COUNT(DISTINCT view_id)::int AS view_count
       FROM ${T("page_views")}
       WHERE link_id = $1 AND document_id = $2 AND time >= $3 AND time <= $4
         AND NOT (view_id = ANY($5::text[]))`,
      p.linkId,
      p.documentId,
      p.since,
      p.until ?? UNTIL,
      csv(p.excludedViewIds),
    ),

  get_total_viewer_duration: (p) =>
    query(
      `SELECT COALESCE(SUM(duration), 0)::float8 AS sum_duration
       FROM ${T("page_views")}
       WHERE view_id = ANY($1::text[]) AND time >= $2 AND time <= $3`,
      csv(p.viewIds),
      p.since,
      p.until ?? UNTIL,
    ),

  // v2: from the page views of one view of a document
  get_useragent_per_view__v2: (p) =>
    query(
      `SELECT data->>'country' AS country, data->>'city' AS city,
              data->>'browser' AS browser, data->>'os' AS os, data->>'device' AS device
       FROM ${T("page_views")}
       WHERE document_id = $1 AND view_id = $2 AND time >= $3
       LIMIT 1`,
      p.documentId,
      p.viewId,
      p.since,
    ),

  // v3: from the link-open event of the view
  get_useragent_per_view: (p) =>
    query(
      `SELECT data->>'country' AS country, data->>'city' AS city,
              data->>'browser' AS browser, data->>'os' AS os, data->>'device' AS device
       FROM ${T("pm_click_events")} WHERE view_id = $1 LIMIT 1`,
      p.viewId,
    ),

  get_total_dataroom_duration: (p) =>
    query(
      `SELECT view_id AS "viewId", SUM(duration)::float8 AS sum_duration
       FROM ${T("page_views")}
       WHERE dataroom_id = $1 AND time >= $2 AND time <= $3
         AND NOT (link_id = ANY($4::text[])) AND NOT (view_id = ANY($5::text[]))
       GROUP BY 1`,
      p.dataroomId,
      p.since,
      p.until ?? UNTIL,
      arr(p.excludedLinkIds),
      arr(p.excludedViewIds),
    ),

  get_document_duration_per_viewer: (p) =>
    query(
      `SELECT COALESCE(SUM(duration), 0)::float8 AS sum_duration
       FROM ${T("page_views")}
       WHERE document_id = $1 AND view_id = ANY($2::text[])`,
      p.documentId,
      csv(p.viewIds),
    ),

  get_webhook_events: (p) =>
    query(
      // Tinybird's zone-less UTC "YYYY-MM-DD HH:MM:SS.mmm": the webhook
      // event list (components/webhooks/webhook-events.tsx) corrects for it.
      `SELECT data || jsonb_build_object('timestamp',
         to_char(ts AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS.MS')) AS row
       FROM ${T("webhook_events")} WHERE webhook_id = $1
       ORDER BY ts DESC LIMIT 100`,
      p.webhookId,
    ).then((rows) => rows.map((r) => r.row)),

  get_video_events_by_document: (p) =>
    query(
      `SELECT ${ts()} AS timestamp, view_id, data->>'event_type' AS event_type,
              (data->>'start_time')::float8 AS start_time,
              COALESCE((data->>'end_time')::float8, 0) AS end_time,
              (data->>'playback_rate')::float8 AS playback_rate,
              (data->>'volume')::float8 AS volume,
              (data->>'is_muted')::float8 AS is_muted,
              (data->>'is_focused')::float8 AS is_focused,
              (data->>'is_fullscreen')::float8 AS is_fullscreen
       FROM ${T("video_views")} WHERE document_id = $1 ORDER BY ts`,
      p.document_id,
    ),

  get_video_events_by_view: (p) =>
    query(
      `SELECT ${ts()} AS timestamp, data->>'event_type' AS event_type,
              (data->>'start_time')::float8 AS start_time,
              COALESCE((data->>'end_time')::float8, 0) AS end_time,
              (data->>'playback_rate')::float8 AS playback_rate,
              (data->>'volume')::float8 AS volume,
              (data->>'is_muted')::float8 AS is_muted,
              (data->>'is_focused')::float8 AS is_focused,
              (data->>'is_fullscreen')::float8 AS is_fullscreen
       FROM ${T("video_views")} WHERE document_id = $1 AND view_id = $2 ORDER BY ts`,
      p.document_id,
      p.view_id,
    ),

  get_click_events_by_view: (p) =>
    query(
      `SELECT ${ts()} AS timestamp, document_id, data->>'dataroom_id' AS dataroom_id,
              view_id, data->>'page_number' AS page_number,
              (data->>'version_number')::int AS version_number, data->>'href' AS href
       FROM ${T("click_events")} WHERE document_id = $1 AND view_id = $2 ORDER BY ts`,
      p.document_id,
      p.view_id,
    ),

  get_dataroom_view_document_stats: (p) =>
    query(
      `SELECT view_id AS "viewId", document_id AS "documentId",
              SUM(duration)::float8 AS sum_duration,
              COUNT(DISTINCT page_number)::int AS pages_viewed
       FROM ${T("page_views")} WHERE view_id = ANY($1::text[])
       GROUP BY 1, 2`,
      csv(p.viewIds),
    ),

  get_total_team_duration: async (p) => {
    const ids = String(p.documentIds ?? "").split(",");
    const since = p.since ?? 0;
    const until = p.until ?? UNTIL;
    const [d] = await query(
      `SELECT COALESCE(SUM(duration), 0)::float8 AS total_duration
       FROM ${T("page_views")}
       WHERE document_id = ANY($1::text[]) AND time >= $2 AND time < $3`,
      ids,
      since,
      until,
    );
    const countries = await query(
      `SELECT DISTINCT country FROM ${T("pm_click_events")}
       WHERE document_id = ANY($1::text[])
         AND ts >= to_timestamp($2 / 1000.0) AND ts < to_timestamp($3 / 1000.0)
         AND country IS NOT NULL AND country NOT IN ('Unknown', '')`,
      ids,
      since,
      Math.min(until, 32503680000000), // to_timestamp's range
    );
    return [
      {
        total_duration: d.total_duration,
        unique_countries: countries.map((c) => c.country),
      },
    ];
  },
};

/** The implementation for a Tinybird pipe name such as "x__v5". */
export function pipeFor(name: string) {
  return PIPES[name] ?? PIPES[name.replace(/__v\d+$/, "")];
}
