/**
 * [fork] Stand-in for `@chronark/zod-bird` (the Tinybird client), aliased in
 * next.config.mjs and oss/tsconfig.jobs.json when ANALYTICS_BACKEND=postgres
 * (the default). Same API as zod-bird 0.3: buildIngestEndpoint validates
 * events with the caller's schema and stores them in Postgres;
 * buildPipe runs the matching query from oss/analytics/pipes.ts and
 * validates the rows with the caller's data schema. lib/tinybird/*.ts and its
 * callers stay unchanged.
 */
import { z } from "zod";

import { pipeFor } from "./pipes";
import { insertEvents } from "./store";

type Config = { baseUrl?: string; token?: string; noop?: true };

export class Tinybird {
  // The token and base URL are Tinybird's; nothing to configure here.
  constructor(_config?: Config) {}

  buildPipe<
    TParameters extends z.ZodSchema<any>,
    TData extends z.ZodSchema<any>,
  >(req: {
    pipe: string;
    parameters?: TParameters;
    data: TData;
    opts?: unknown;
  }): (params: z.input<TParameters>) => Promise<{
    meta: { name: string; type: string }[];
    rows?: number;
    data: z.output<TData>[];
  }> {
    const run = pipeFor(req.pipe);
    if (!run)
      throw new Error(`No Postgres query for Tinybird pipe ${req.pipe}`);
    return async (params) => {
      const validated = req.parameters ? req.parameters.parse(params) : params;
      const rows = await run(validated ?? {});
      const data = z.array(req.data).parse(rows);
      return { meta: [], rows: data.length, data };
    };
  }

  buildIngestEndpoint<TSchema extends z.ZodSchema<any>>(req: {
    datasource: string;
    event: TSchema;
    wait?: boolean;
  }): (
    events: z.input<TSchema> | z.input<TSchema>[],
  ) => Promise<{ successful_rows: number; quarantined_rows: number }> {
    return async (events) => {
      const list = Array.isArray(events) ? events : [events];
      const parsed = z.array(req.event).parse(list);
      await insertEvents(req.datasource, parsed);
      return { successful_rows: parsed.length, quarantined_rows: 0 };
    };
  }
}

/** zod-bird's no-op client: returns empty data, stores nothing. */
export class NoopTinybird extends Tinybird {
  buildPipe(req: any): any {
    return async () => ({ meta: [], data: [] });
  }
  buildIngestEndpoint(req: any): any {
    return async (events: unknown) => ({
      successful_rows: Array.isArray(events) ? events.length : 1,
      quarantined_rows: 0,
    });
  }
}
