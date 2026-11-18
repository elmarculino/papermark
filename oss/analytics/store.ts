/**
 * [fork] Postgres storage for the view analytics upstream keeps in Tinybird.
 * One table per Tinybird datasource in schema `papermark_analytics` (created
 * on first use): the columns the queries filter or group on, plus the whole
 * event as `data` jsonb. Outside Prisma's schema, so Prisma migrations never
 * see it.
 */
import prisma from "@/lib/prisma";

export const SCHEMA = "papermark_analytics";

const DDL = [
  `CREATE SCHEMA IF NOT EXISTS ${SCHEMA}`,
  `CREATE TABLE IF NOT EXISTS ${SCHEMA}.page_views (
     id text, link_id text NOT NULL, document_id text NOT NULL,
     view_id text NOT NULL, dataroom_id text, version_number int NOT NULL,
     time bigint NOT NULL, duration bigint NOT NULL, page_number text NOT NULL,
     data jsonb NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS page_views_document ON ${SCHEMA}.page_views (document_id, view_id)`,
  `CREATE INDEX IF NOT EXISTS page_views_view ON ${SCHEMA}.page_views (view_id)`,
  `CREATE INDEX IF NOT EXISTS page_views_link ON ${SCHEMA}.page_views (link_id)`,
  `CREATE INDEX IF NOT EXISTS page_views_dataroom ON ${SCHEMA}.page_views (dataroom_id) WHERE dataroom_id IS NOT NULL`,
  `CREATE TABLE IF NOT EXISTS ${SCHEMA}.click_events (
     ts timestamptz NOT NULL, document_id text NOT NULL, view_id text NOT NULL,
     data jsonb NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS click_events_view ON ${SCHEMA}.click_events (document_id, view_id, ts)`,
  `CREATE TABLE IF NOT EXISTS ${SCHEMA}.pm_click_events (
     ts timestamptz NOT NULL, view_id text NOT NULL, link_id text NOT NULL,
     document_id text, country text, data jsonb NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS pm_click_events_view ON ${SCHEMA}.pm_click_events (view_id)`,
  `CREATE INDEX IF NOT EXISTS pm_click_events_document ON ${SCHEMA}.pm_click_events (document_id, ts)`,
  `CREATE TABLE IF NOT EXISTS ${SCHEMA}.video_views (
     ts timestamptz NOT NULL, document_id text NOT NULL, view_id text NOT NULL,
     data jsonb NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS video_views_view ON ${SCHEMA}.video_views (document_id, view_id, ts)`,
  `CREATE TABLE IF NOT EXISTS ${SCHEMA}.webhook_events (
     ts timestamptz NOT NULL DEFAULT now(), webhook_id text NOT NULL,
     data jsonb NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS webhook_events_webhook ON ${SCHEMA}.webhook_events (webhook_id, ts DESC)`,
];

let ready: Promise<void> | undefined;

/** Creates the schema once per process; concurrent processes serialise. */
export function ensureAnalyticsSchema(): Promise<void> {
  ready ??= prisma
    .$transaction(async (tx) => {
      await tx.$executeRawUnsafe(
        `SELECT pg_advisory_xact_lock(hashtext('${SCHEMA}'))`,
      );
      for (const statement of DDL) await tx.$executeRawUnsafe(statement);
    })
    .catch((error) => {
      ready = undefined; // retry on the next call
      throw error;
    });
  return ready;
}

/** Tinybird timestamps without a zone are UTC. */
export function utc(value: unknown): string {
  const s = String(value ?? "");
  if (!s) return new Date().toISOString();
  const iso = s.includes("T") ? s : s.replace(" ", "T");
  return /([zZ]|[+-]\d\d:?\d\d)$/.test(iso) ? iso : `${iso}Z`;
}

type Row = Record<string, any>;

/** Insert validated events into the table for a Tinybird datasource. */
export async function insertEvents(datasource: string, events: Row[]) {
  if (events.length === 0) return;
  await ensureAnalyticsSchema();
  const base = datasource.replace(/__v\d+$/, "");
  for (const e of events) {
    const data = JSON.stringify(e);
    switch (base) {
      case "page_views":
        await prisma.$executeRawUnsafe(
          `INSERT INTO ${SCHEMA}.page_views (id, link_id, document_id, view_id, dataroom_id, version_number, time, duration, page_number, data)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb)`,
          e.id,
          e.linkId,
          e.documentId,
          e.viewId,
          e.dataroomId ?? null,
          e.versionNumber ?? 1,
          BigInt(e.time),
          BigInt(e.duration),
          String(e.pageNumber),
          data,
        );
        break;
      case "click_events":
      case "video_views":
        await prisma.$executeRawUnsafe(
          `INSERT INTO ${SCHEMA}.${base} (ts, document_id, view_id, data)
           VALUES ($1::timestamptz, $2, $3, $4::jsonb)`,
          utc(e.timestamp),
          e.document_id,
          e.view_id,
          data,
        );
        break;
      case "pm_click_events":
        await prisma.$executeRawUnsafe(
          `INSERT INTO ${SCHEMA}.pm_click_events (ts, view_id, link_id, document_id, country, data)
           VALUES ($1::timestamptz, $2, $3, $4, $5, $6::jsonb)`,
          utc(e.timestamp),
          e.view_id,
          e.link_id,
          e.document_id ?? null,
          e.country ?? null,
          data,
        );
        break;
      case "webhook_events":
        await prisma.$executeRawUnsafe(
          `INSERT INTO ${SCHEMA}.webhook_events (webhook_id, data) VALUES ($1, $2::jsonb)`,
          e.webhook_id,
          data,
        );
        break;
      default:
        throw new Error(`Unknown analytics datasource: ${datasource}`);
    }
  }
}

export async function query(sql: string, ...params: unknown[]) {
  await ensureAnalyticsSchema();
  return prisma.$queryRawUnsafe<Row[]>(sql, ...params);
}
