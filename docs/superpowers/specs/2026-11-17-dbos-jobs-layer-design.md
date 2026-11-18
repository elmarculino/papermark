# Background jobs without Trigger.dev: a DBOS compatibility layer

Status: draft for review · 2026-11-17 · Fork: `elmarculino/papermark`

## Why

Papermark runs all slow work as Trigger.dev tasks: rendering PDF pages, Office/Keynote → PDF, video processing, exports, notifications, delayed emails. Self-hosted Trigger.dev is 7+ containers (webapp, Postgres, Redis, ClickHouse, Electric, MinIO, S2) plus a worker and an image registry, about 6 GB for the webapp side alone. The fork must run on a modest server, alongside other things, using only open-source software.

The goal right now is a **working self-hosted Papermark**. Job tooling beyond "it works and failures are visible" comes later.

## What we're building

A drop-in replacement for the parts of `@trigger.dev/sdk` and `@trigger.dev/react-hooks` that Papermark uses, backed by **[DBOS Transact](https://docs.dbos.dev/typescript/)** (MIT, a library that keeps durable workflow state in Postgres). Papermark's own Postgres holds the job state. A single worker process runs the jobs.

- The 29 upstream files that import `@trigger.dev/*` stay unchanged. The layer is reached through module aliasing, the same approach the fork uses for `@/ee/*` → `./oss/*` (see `oss/README.md`).
- One setting, `JOBS_BACKEND`, picks the backend: `dbos` (default, dev and production) or `trigger` (the real Trigger.dev SDK, cloud or self-hosted, unchanged behavior).

## Goals

1. Every job Papermark triggers today runs on DBOS with the same observable behavior:
   - upload → page images, with the progress bar in the UI;
   - Office/Keynote → PDF (Gotenberg) → pages;
   - video optimization;
   - visit exports and the daily `cleanup-expired-exports` cron (`0 2 * * *`);
   - data-room change/upload notifications;
   - agreement signing-template setup, with its progress in the link sheet;
   - the remaining notification and email tasks.
2. Delays survive restarts: `delay: "1d" | "6d" | "7d"` must still fire after the app or worker restarts.
3. Same semantics as today for idempotency keys, retries (`retry` config and `maxAttempts`), per-team `concurrencyKey`, named queues, tags, run metadata (progress), `triggerAndWait`, and run listing/retrieval/cancellation.
4. Failures are visible: a job that ends in failure logs the task id, run id, payload summary (no secrets) and error to the worker's stdout, and its status reads as failed through `runs.retrieve` (so the UI shows the failure where it already does today).
5. Dev = production: on the Mac, jobs run through the same DBOS worker against the local Postgres container.

## Non-goals (for now)

- A jobs dashboard or admin UI (a later project).
- Multi-server scaling of workers. One worker process; DBOS handles its own recovery.
- Trigger.dev features Papermark doesn't use: machine presets (`machine:` is ignored), realtime streams, waitpoints, batch-trigger-and-wait, deployments/versions.
- Replacing the AWS Lambda that bulk ZIP download calls (separate item in `oss/MAP.md`).

## Anti-goals (would count as failure even if it "works")

- Editing upstream call sites to fit the layer. If a call site seems to need an edit, extend the layer instead.
- Losing jobs silently: an unknown task id, an unsupported option or a missing handler must throw a clear error (at worker start where possible, else at trigger time). It must never be dropped.
- Adding a new always-on service. DBOS is a library; the only new process is the job worker, built from this same codebase.

## The surface to cover

Measured from the code on 2026-11-17 (`grep` across `lib pages app components oss context`):

| Area | Used |
|---|---|
| Defining tasks | `task({ id, run, retry, queue, machine })` (15 files), `schemaTask` (1), `schedules.task({ id, cron, run })` (1), `queue({ name, concurrencyLimit })` (`lib/trigger/queues.ts`) |
| Triggering | `<task>.trigger(payload, opts)` (22), `<task>.triggerAndWait` (1, `pdf-to-image-route` → `convert-pdf-direct`), `<task>.batchTrigger` (1), `tasks.trigger<typeof T>("id", payload, opts)` (3) |
| Trigger options | `tags` (43), `metadata` (29), `idempotencyKey` (22), `queue` (14), `concurrencyKey` (11), `maxAttempts` (9), `delay` (6), `machine` (3, ignore), `priority` (1) |
| Inside a run | `logger.*`, `metadata.set` (progress via `lib/utils/generate-trigger-status.ts`; also `setup-signing-template`), `metadata.parent.set`, `AbortTaskRunError` (no retry), run context (`ctx.run.id` etc. where used) |
| Run control (server) | `runs.retrieve`, `runs.list` (by tag), `runs.cancel`; `auth.createPublicToken` (`lib/utils/generate-trigger-auth-token.ts`, signing setup) |
| UI hooks | `useRealtimeRunsWithTag` (`lib/utils/use-progress-status.ts`, upload progress), `useRealtimeRun` (`components/links/link-sheet/agreement-panel`) |

The builder should regenerate this table from the code at the start; upstream may have moved.

## Decided

- **Library:** DBOS Transact for TypeScript (MIT), current major (v2+), on the existing Papermark Postgres (`POSTGRES_PRISMA_URL`). Chosen over BullMQ because per-key concurrency is free (partitioned queues) whereas BullMQ needs the paid Pro edition, and because durable sleeps and schedules come built in. The owner already runs DBOS in another project.
- **Shape:** compatibility layer under `oss/jobs/` (exact layout is the builder's), wired by aliasing the package names `@trigger.dev/sdk` and `@trigger.dev/react-hooks`, consistent with how `@/ee/*` is aliased.
- **Backend switch:** `JOBS_BACKEND=dbos|trigger`, default `dbos`. With `trigger`, everything behaves exactly as upstream today: Trigger.dev SDK, `trigger.config.ts`, `trigger.dev dev`.
- **Processes:** the Next.js app only *enqueues* and reads run state; a separate worker process (`npm run jobs:worker`, same image in production) imports every task file and executes them. The task directories are those listed in `trigger.config.ts` (`./lib/trigger`, `./oss/**/lib/trigger`), plus task definitions that live elsewhere (e.g. `oss/features/conversions`).
- **Worker needs:** Node, `mupdf` (WASM), `ffmpeg`, Prisma client. No Python: the `pythonExtension` in `trigger.config.ts` matches no scripts (the repo has no `.py` files; the Pipfile only installs `tinybird-cli`).
- **Progress in the UI:** the two React hooks keep their names and return shapes. Instead of Trigger.dev realtime they poll a small authenticated API route in the fork every ~1–2 s while a run isn't finished. `auth.createPublicToken` returns a token our route accepts, scoped like today (by tag / run id). Status strings and the `metadata` object keep Trigger.dev's names, so `use-progress-status` and the agreement panel work unchanged.
- **Failure visibility (v1):** structured log line on failure, failed status through `runs.*`. Nothing more.

## Semantics the builder must preserve

- **`idempotencyKey`:** triggering twice with the same key returns the existing run, as in Trigger.dev, and does not run the task twice.
- **`concurrencyKey` + `queue`:** at most the queue's limit of concurrent runs per key (per team today). Queues without a key use their global limit; `lib/trigger/queues.ts` defines the names and limits, and `conversionQueueName(plan)` picks one per plan.
- **`delay`:** the run starts after the delay and survives restarts of app and worker.
- **Retries:** task `retry` config and per-trigger `maxAttempts`, with backoff. `AbortTaskRunError` ends the run as failed without retrying. (`onFailure` exists in the SDK but no task uses it; throw a clear "not supported" error if one ever appears.)
- **`triggerAndWait`:** the parent waits durably for the child's result.
- **`metadata`:** `metadata.set` inside a run, and `metadata.parent.set`, become visible to `runs.retrieve` and the hooks while the run is still going.
- **Tags:** stored per run and queryable (`runs.list({ tag })`, `useRealtimeRunsWithTag`).
- **Cron:** `schedules.task` with `cron` runs on schedule exactly once per tick, even if the worker restarts around it.

## Calls made while writing this (the owner may override)

- **Scope ends at the worker command.** This project delivers `npm run jobs:worker` and documents what the worker needs (Node, mupdf, ffmpeg, Prisma, env). The production Dockerfile and Komodo stack are the next item in the `oss/MAP.md` queue, not part of this.
- **The backend is chosen once per install.** Switching `JOBS_BACKEND` on a database that has in-flight runs isn't supported. The dev database can simply be reset. Given a run id from the other backend (e.g. a stored `triggerRunId` passed to `runs.retrieve`/`runs.cancel`), the layer throws a clear "unknown run" error. No migration or coexistence logic.
- **A worker-wide cap on top of the per-key limits.** `JOBS_WORKER_CONCURRENCY` (default 4) bounds how many runs execute at once in the worker, in addition to each queue's per-`concurrencyKey` limit. This deliberately departs from Trigger.dev (which gives each run its own machine), so a small server can't be overrun. With one team per install, the per-team limits rarely bind anyway.
- **Runs execute in-process for v1.** mupdf and ffmpeg run inside the worker process, as they do in `trigger.dev dev`. If one job crashes the process, DBOS recovery replays in-flight runs; a task that crashes repeatedly must end as failed after its retry budget rather than crash-loop the worker. Moving heavy tasks into child processes is a later improvement if memory becomes a problem.

## Left to the builder

- DBOS API details: how tasks map onto workflows and steps (e.g. task body as one retried step inside a workflow; delays as `DBOS.sleep` before it; `triggerAndWait` as child workflow + result). Verify each against the DBOS TypeScript docs; don't rely on memory.
- Where tags, metadata and Trigger-style statuses live (DBOS workflow events, or a small table owned by the layer; its own schema is fine, without touching upstream Prisma models).
- How the app enqueues without hosting workflows (e.g. DBOS's client API).
- Module-alias mechanics so `JOBS_BACKEND=trigger` can still reach the real packages, plus making sure the Trigger.dev CLI build isn't broken by the alias.
- The worker command and the env vars beyond `JOBS_BACKEND` and `JOBS_WORKER_CONCURRENCY`.
- Proof: runtime `*.verify.ts` scripts in the style of `oss/` (real Postgres; no mocks of DBOS) for each guarantee above, plus a browser check of the upload progress bar and the signing-setup progress.

## Done when

- `npx tsc --noEmit` and `next build` pass with `JOBS_BACKEND=dbos`.
- On the Mac with only the existing `pm-*` containers (Postgres, S3, Redis, Gotenberg, Mailpit), with no Trigger.dev account or stack: a PDF upload shows progress and renders pages; a `.docx` converts and renders; the cron and delayed jobs fire (verified with short test delays); failures appear in the worker log and as failed runs.
- `JOBS_BACKEND=trigger` still works against the Trigger.dev Cloud dev project.
- `oss/MAP.md` and `oss/README.md` describe the switch, the worker and its env.
