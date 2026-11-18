# Background jobs without Trigger.dev: a DBOS compatibility layer

Status: draft for review, revised after review by Fable · 2026-11-17 · Fork: `elmarculino/papermark`

## Why

Papermark runs all slow work as Trigger.dev tasks: rendering PDF pages, Office/Keynote → PDF, video processing, exports, notifications, delayed emails. Self-hosted Trigger.dev is 7+ containers (webapp, Postgres, Redis, ClickHouse, Electric, MinIO, S2) plus a worker and an image registry, about 6 GB for the webapp side alone. The fork must run on a modest server, alongside other things, using only open-source software.

The goal right now is a **working self-hosted Papermark**. Job tooling beyond "it works and failures are visible" comes later.

## What we're building

A drop-in replacement for the parts of `@trigger.dev/sdk` and `@trigger.dev/react-hooks` that Papermark uses, backed by **[DBOS Transact](https://docs.dbos.dev/typescript/)** (`@dbos-inc/dbos-sdk`, MIT, pinned to the 5.x line). DBOS is a library that keeps durable workflow state in Postgres (its own `dbos` schema in Papermark's database). A single worker process runs the jobs; the Next.js app only enqueues and reads run state.

- The 29 upstream files that import `@trigger.dev/*` stay unchanged. The layer is swapped in by **runtime module aliasing** (see "Wiring"), not by editing call sites.
- One setting, `JOBS_BACKEND`, picks the backend: `dbos` (default, dev and production) or `trigger` (the real Trigger.dev SDK, cloud or self-hosted, unchanged behavior). For the app it's a **build-time** setting: an image is built for one backend.

## Goals

1. Every job Papermark triggers today runs on DBOS with the same observable behavior:
   - upload → page images, with the progress bar in the UI;
   - Office/Keynote → PDF (Gotenberg) → pages;
   - video processing;
   - visit exports and the daily `cleanup-expired-exports` cron (`0 2 * * *` UTC);
   - data-room change/upload notifications, including the 10-minute debounce in `pages/api/teams/[teamId]/datarooms/[id]/documents/index.ts` (lists `DELAYED`/`QUEUED` runs, reads their `payload`, cancels and re-triggers);
   - agreement signing-template setup, with its progress and "fresh retry" in the link sheet;
   - the remaining notification and email tasks.
2. Delays survive restarts and don't occupy workers while waiting (`delay` as `"1d"`-style strings or a `Date`).
3. Same semantics as today for idempotency keys, retries, per-team `concurrencyKey`, named queues, tags, run metadata (progress), `triggerAndWait`, and run listing/retrieval/cancellation (details below).
4. Failures are visible: a run that ends failed logs task id, run id, a payload summary (no secrets) and the error to the worker's stdout, and reads as failed through `runs.*`, so the UI shows the failure where it already does today.
5. Dev = production: on the Mac, jobs run through the same DBOS worker against the local Postgres container.

## Non-goals (for now)

- A jobs dashboard or admin UI (later project).
- Multi-server scaling of workers. One worker process.
- Trigger.dev features Papermark doesn't use: machine presets (`machine:` is ignored), realtime streams, waitpoints, batch-trigger-and-wait, deployments/versions, `onFailure` (unused: throw "not supported" if one appears), `priority` (unused).
- Replacing the AWS Lambda that bulk ZIP download calls (separate item in `oss/MAP.md`).
- The production Dockerfile and Komodo stack (next queue item; this project documents what the worker needs).

## Anti-goals (failure even if it "works")

- Editing upstream call sites to fit the layer. Extend the layer instead.
- Losing jobs silently: an unknown task id, an unregistered queue name, an unsupported option or a missing handler throws a clear error at worker start or at trigger time. Nothing may sit `ENQUEUED` forever.
- Adding a new always-on service. The only new process is the job worker, built from this codebase.

## The surface to cover

Measured from the code on 2026-11-17 (the builder should regenerate it; upstream moves):

| Area | Used |
|---|---|
| Defining tasks | 22 `task()` definitions in 15 files (`id`, `run`, `retry`, `queue`, `machine`), `schemaTask` (1), `schedules.task({ id, cron, run })` (1, `cleanup-expired-exports`, reads `payload.timestamp`), `queue({ name, concurrencyLimit })` (`lib/trigger/queues.ts`) |
| Defaults | `trigger.config.ts`: `retries.default` (3 attempts, 1–10 s, factor 2, jitter) for tasks without `retry`; `retries.enabledInDev: false` |
| Triggering | `<task>.trigger(payload, opts)` (22), `<task>.triggerAndWait` (1, `pdf-to-image-route` → `convert-pdf-direct`, returns `{ ok, output }`), `<task>.batchTrigger` (1), `tasks.trigger<typeof T>("id", …)` (4 calls in 3 files) |
| Trigger options | `tags`, `idempotencyKey`, `queue` (names chosen at trigger time, e.g. `conversionQueueName(plan)`, `"video-length-backfill"`), `concurrencyKey` (sometimes present, sometimes not, for the same queue), `maxAttempts`, `delay` (4, string or `Date`), `metadata` (5) |
| Inside a run | `logger.*`, `metadata.set` (sync; via `lib/utils/generate-trigger-status.ts` and `setup-signing-template`), `metadata.parent.set`, `AbortTaskRunError`. No task reads `ctx`. |
| Run control (server) | `runs.retrieve` (uses `payload`, `output`, `status`, `isFailed`, `isCompleted`, and trigger-time `metadata`: `setup-status.ts` authorizes on `metadata.teamId`/`agreementId`), `runs.list({ taskIdentifier, tag: [...], status: [...], period })` → `.data[].tags`, `runs.cancel`, `auth.createPublicToken` |
| UI hooks | `useRealtimeRunsWithTag` (`lib/utils/use-progress-status.ts`, whose types derive from the hook's `ReturnType`), `useRealtimeRun` (`components/links/link-sheet/agreement-panel`) |

Only `pages/api` routes and task files import the SDK; no edge route, middleware, app-router entry or client component does (except the two hooks).

## Decided

### Library and data

- **DBOS Transact** for TypeScript (`@dbos-inc/dbos-sdk` 5.x), MIT. Chosen over BullMQ because per-key concurrency is free (partitioned queues), where BullMQ needs the paid Pro edition, and because delayed enqueue and database-backed schedules come built in. The owner already runs DBOS in another project.
- **Database:** Papermark's Postgres through the **direct** URL (`POSTGRES_PRISMA_URL_NON_POOLING`, with Prisma-only query parameters stripped), not the pooled one. DBOS uses its own `dbos` schema. The layer may add its own small tables (in its own schema), never touching upstream Prisma models.
- **Pinned `applicationVersion`:** the worker sets a constant `applicationVersion`. DBOS's default is a hash of workflow source, and recovery only resumes workflows of the same version, so every deploy would otherwise orphan in-flight runs. Safe here because a task body re-runs from the top on recovery anyway.
- **Client singleton:** the app's DBOS client lives on `globalThis` with a small pool, so dev hot-reload doesn't leak connections.

### Wiring

- **Aliasing at runtime only, not in the root `tsconfig.json`.** `tsc` keeps resolving the real `@trigger.dev/*` packages for types; `trigger.config.ts` and `use-progress-status.ts` depend on that.
  - App: when `JOBS_BACKEND=dbos`, the existing webpack hook in `next.config.mjs` adds `resolve.alias` entries for `@trigger.dev/sdk` and `@trigger.dev/react-hooks` → the layer. In `trigger` mode there's no alias, so the real packages and the Trigger.dev CLI are untouched.
  - Worker: run with `tsx` and a worker-only tsconfig that adds the aliases (the pattern of `oss/tsconfig.verify.json`).
  - The layer asserts it matches the real API: `satisfies Pick<typeof import("@trigger.dev/sdk"), …>` (and the same for the hooks), so type drift fails `tsc`.
  - The DBOS package goes in the server externals and is aliased to `false` in the client build.
- **Processes:** the app only enqueues (DBOS client API) and reads run state. The worker imports every task file (the `dirs` in `trigger.config.ts`: `./lib/trigger`, `./oss/**/lib/trigger`, plus `oss/features/ai/lib/trigger.ts`) and executes them.

### Execution model

- **The task body is the workflow function**, not a single step inside one. The layer runs its own retry loop around it. Recovery re-runs the body from the top, which matches a Trigger.dev retry.
- **Run context** (run id, parent id, task id) travels in `AsyncLocalStorage`, so `metadata.set`, `metadata.parent.set`, `logger` and nested `.trigger()` calls know which run they belong to.
- **Run state the app reads** (Trigger-style status, tags, trigger-time metadata merged with later `metadata.set`, payload, output, error) lives in a layer-owned table, written fire-and-forget from the synchronous `metadata.set`. DBOS's own tables stay the source of truth for execution.
- **Retries:** the task's `retry`, else `trigger.config.ts`'s `retries.default`; per-trigger `maxAttempts` overrides. Retries stay on in dev mode for the DBOS backend. `AbortTaskRunError` ends the run as failed without retrying.
- **Crashes vs. retries:** DBOS's `maxRecoveryAttempts` (default 100) is set explicitly and low, so a task that keeps killing the worker (out of memory in mupdf/ffmpeg) ends as `CRASHED` instead of crash-looping.
- **Delays:** native **delayed enqueue** (`delaySeconds`; DBOS status `DELAYED`, then `ENQUEUED`), not `DBOS.sleep`. A sleeping workflow would hold a worker slot for days, and would read as executing, breaking the debounce. `Date` delays become seconds from now.
- **Idempotency:** a layer-owned table maps (task id, scope, key) → run id, with Trigger.dev's behavior: the key returns the existing run while that run is queued, running or succeeded (within a TTL); a **failed** run frees its key; keys are scoped per task; raw keys triggered *inside* a run are scoped to that run (Trigger SDK ≥ 4.3.1 behavior). Workflow ids are generated. The mapping insert and the enqueue share one transaction (`enqueueInTransaction`).
- **Queues and concurrency:**
  - each Trigger.dev queue maps to a DBOS queue; per-`concurrencyKey` limits use partitioned queues; enqueues without a key go to a default partition;
  - the queue name given at trigger time wins over the task's declared queue; tasks without any queue go to a default queue;
  - unknown queue names throw at trigger time;
  - a **worker-wide cap** (`JOBS_WORKER_CONCURRENCY`, default 4) is a layer semaphore across all queues (DBOS's `workerConcurrency` is per queue). A parent blocked in `triggerAndWait` gives back its slot while it waits.
- **`triggerAndWait`:** child workflow plus awaited result, returning `{ ok, output }` / `{ ok: false, error }` like the SDK.
- **Cancellation:** `runs.cancel` cancels queued and delayed runs cleanly. For running bodies, the layer checks the cancel flag at each `metadata.set`/`logger` call and throws there, so long tasks stop at their next checkpoint.
- **Cron:** `schedules.task` maps to a DBOS scheduled workflow with `cronTimezone: "UTC"`, `payload.timestamp` filled from the scheduled time, no backfill of missed ticks, exactly one run per tick.
- **Statuses:** DBOS → Trigger names: `ENQUEUED` → `QUEUED`, `DELAYED` → `DELAYED`, `PENDING` → `EXECUTING`, `SUCCESS` → `COMPLETED`, `ERROR` → `FAILED`, `CANCELLED` → `CANCELED`, max recovery exceeded → `CRASHED`.

### UI progress

- The two hooks keep their names and return shapes, and poll an authenticated API route in the fork every ~1–2 s while a run isn't finished. The route lives outside `pages/api/jobs/*`, which upstream already uses.
- `auth.createPublicToken` returns a token that route accepts, scoped like today (by tag / run id).

### The worker's environment

On a self-host the PDF path doesn't run mupdf in the worker: `pdf-to-image-route` only goes "direct" for two hardcoded upstream team ids (`DIRECT_CONVERSION_TEAM_IDS`). It renders pages through the app's `/api/mupdf/*` routes over HTTP. So the worker needs the app reachable and `NEXT_PUBLIC_BASE_URL`, `NEXTAUTH_URL`, `INTERNAL_API_KEY`, `REVALIDATE_TOKEN` (plus the database, storage, Gotenberg and SMTP env the tasks use), and `ffmpeg` for video. Python is not needed: no `.py` files exist.

### Failure visibility (v1)

A structured log line on failure and a failed status through `runs.*`. Nothing more.

## Calls made while writing this (the owner may override)

- **Scope ends at the worker command.** `npm run jobs:worker` plus documented needs (above). Dockerfile/Komodo is the next queue item.
- **The backend is chosen once per install** (and at build time for the app). No migration or coexistence of in-flight runs. A run id from the other backend gets a clear "unknown run" error (one caller, `export-jobs/[exportId].ts`, swallows cancel errors; acceptable).
- **Worker-wide cap of 4** on top of per-key limits. This departs from Trigger.dev, which gives each run its own machine, so a small server can't be overrun.
- **Runs execute in the worker process for v1.** A crash takes down all in-flight runs; they recover and re-run, bounded by the explicit `maxRecoveryAttempts`.
- **Replayed side effects are accepted for v1.** Recovery or a retry re-runs a body from the top, so a crash mid-way through e.g. `dataroom-change-notification` can resend emails already sent. Trigger.dev retries have the same exposure. Wrapping per-recipient sends in DBOS steps is a later improvement.

## Left to the builder

- DBOS API details for everything above, verified against the 5.x docs and package (`DBOSClient`, `enqueue`/`enqueueInTransaction`, `delaySeconds`, partitioned queues, `registerScheduled` or equivalent, cancellation, recovery settings), not from memory.
- The layer's table design and file layout under `oss/jobs/`.
- The worker command and the env vars beyond `JOBS_BACKEND` and `JOBS_WORKER_CONCURRENCY`.
- Proof: runtime `*.verify.ts` scripts in the `oss/` style against real Postgres (no DBOS mocks), one per guarantee above. Paths that are unreachable on a self-host (`triggerAndWait` via the direct conversion path, `metadata.parent.set`) are forced in their verify scripts. Plus a browser check of the upload progress bar and the signing-setup progress.

## Done when

- `npx tsc --noEmit` passes, and `next build` passes in both `JOBS_BACKEND=dbos` and `JOBS_BACKEND=trigger`.
- On the Mac with only the existing `pm-*` containers (Postgres, S3, Redis, Gotenberg, Mailpit), with no Trigger.dev account or stack:
  - a PDF upload shows progress and renders pages;
  - a `.docx` converts and renders;
  - the cron, delayed jobs and the notification debounce behave as specified (verified with short test delays);
  - a restart of the worker during a delay or a run loses nothing;
  - failures appear in the worker log and as failed runs.
- `JOBS_BACKEND=trigger` still works against the Trigger.dev Cloud dev project.
- `oss/MAP.md` and `oss/README.md` describe the switch, the worker, its env and how to run it.
