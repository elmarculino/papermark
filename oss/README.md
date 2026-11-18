# oss/

Replacements for the upstream Papermark `ee/` directory (commercial license), which was removed from this fork.

- `tsconfig.json` maps `@/ee/*` → `./oss/*`, so upstream call sites (`import … from "@/ee/…"`) load our code without edits.
- **Clean-room rule:** nothing here is copied, adapted, or translated from upstream `ee/` or `app/(ee)/`. Interfaces are inferred only from the AGPL call sites and public library docs.
- Licensed AGPLv3, like the rest of the repository (see root `LICENSE`).

## After an upstream merge

```sh
npx tsc --noEmit 2>&1 | grep -E "Cannot find module '@/ee/|has no exported member"
```

Every hit is a new `@/ee/…` path or export we need to provide (stub or real code).

## Module status

See [MAP.md](./MAP.md).

## Background jobs

Upstream runs its background tasks (`lib/trigger/*`, conversions, notifications, signing setup, cron) on Trigger.dev. `oss/jobs/` is a drop-in replacement for `@trigger.dev/sdk` and `@trigger.dev/react-hooks`, backed by [DBOS](https://github.com/dbos-inc/dbos-transact-ts) on the app's own Postgres. The 29 upstream files that import `@trigger.dev/*` are unchanged.

- **`JOBS_BACKEND`** = `dbos` (default) or `trigger`; any other value fails the build. It is **build-time**: `next.config.mjs` reads it and, for `dbos`, aliases `@trigger.dev/sdk` and `@trigger.dev/react-hooks` to `oss/jobs/`. Changing it means rebuilding the app (or restarting `next dev`). With `trigger`, the real SDK is used and nothing here runs; set `TRIGGER_SECRET_KEY` and run Trigger.dev's own worker as upstream does.
- **Worker:** `npm run jobs:worker` (`tsx` over `oss/jobs/worker.ts`). It imports every task file, creates its schemas (`papermark_jobs` and `dbos`; override with `JOBS_SCHEMA` / `JOBS_DBOS_SCHEMA`), registers tasks and queues, applies the cron schedules, and then executes runs. Start it before the app triggers anything: until a worker has registered the tasks, `.trigger()` throws `Unknown task "<id>": start the jobs worker…`. One worker per database (see MAP.md, v1 limits). `Ctrl-C` stops it: it stops taking runs and waits up to 30 s (`JOBS_SHUTDOWN_TIMEOUT_MS`) for the executing ones to finish; any still going resume when it starts again.
- **Worker env** (it loads `.env*` like Next does, via `@next/env`):
  - `POSTGRES_PRISMA_URL_NON_POOLING` (falls back to `POSTGRES_PRISMA_URL`; Prisma-only query params are stripped). Same database as the app.
  - Storage: the `NEXT_PUBLIC_UPLOAD_TRANSPORT` / `NEXT_PRIVATE_UPLOAD_*` variables the app uses.
  - `GOTENBERG_URL` (Office/Keynote → PDF).
  - SMTP: `SMTP_*` / `EMAIL_FROM` (tasks that send email).
  - `NEXT_PUBLIC_BASE_URL`, `NEXTAUTH_URL`, `NEXTAUTH_SECRET`, `INTERNAL_API_KEY`, `REVALIDATE_TOKEN`.
  - `JOBS_WORKER_CONCURRENCY`: max concurrent runs in this worker (default `4`, must be a positive integer).
  - `JOBS_DB_POOL_SIZE`: Postgres connections of the layer's pool (must be a positive integer). Defaults: `JOBS_WORKER_CONCURRENCY + 4` in the worker, `3` per app process.
  - `JOBS_SHUTDOWN_TIMEOUT_MS`: how long a stopping worker waits for executing runs (default `30000`; `0` doesn't wait).
  - `ffmpeg` on `PATH` (video tasks).
- **App env the tasks rely on:** `NEXT_PRIVATE_UNSUBSCRIBE_JWT_SECRET` (any long random string) signs the unsubscribe links in data-room notification emails and the team invitation links; without it `/api/jobs/send-dataroom-new-document-notification` returns 500 and the notification task fails.
- **The app must be reachable from the worker.** Several tasks call back into the app over HTTP (`NEXT_PUBLIC_BASE_URL`/`NEXTAUTH_URL` + `INTERNAL_API_KEY`), e.g. PDF page rendering (`/api/mupdf/*`) and notification emails. In containers, point those URLs at an address the worker can resolve.
- **Progress in the UI:** the hooks poll `GET /api/job-runs` every 1.5 s with an HMAC token (signed with `NEXTAUTH_SECRET`, read-only and scoped; it lives at least 24 hours even when the caller asks for 15 minutes, so a long conversion still reports completion), so the app needs no extra service.
- **Failures** show up as one JSON line per failed run (after its last attempt) on the worker's stderr, `{"level":"error","event":"job.failed","taskId":…,"runId":…,"attempt":…,"error":…}` (the payload keeps only id fields such as `teamId`; other values are reduced to their type), and the run ends `FAILED` (or `CRASHED` after 3 recovery attempts). Run state lives in `dbos.workflow_status` and `papermark_jobs.runs`.

```sh
npm run jobs:worker                    # terminal 1: "jobs worker ready: N tasks, N queues, N schedules, concurrency 4"
npx next dev                           # terminal 2 (JOBS_BACKEND defaults to dbos)
JOBS_BACKEND=trigger npx next dev      # upstream behaviour, with npx trigger.dev dev
```

## Custom link domains

Without a Vercel project (`PROJECT_ID_VERCEL` unset), teams' custom link domains are served by this install (`oss/domains/self-host.ts`). The app checks the domain's DNS against the install's target and shows the records to create:

- `CUSTOM_DOMAIN_TARGET_CNAME`: the hostname a CNAME should point to (blank = the public link host from `NEXT_PUBLIC_MARKETING_URL`).
- `CUSTOM_DOMAIN_TARGET_IPS`: the public IPv4 address(es) an A record may point to, comma-separated (blank = what the CNAME target resolves to).

Certificates come from the reverse proxy. With Caddy, on-demand TLS asks the app before requesting a certificate, so only domains a team has added and verified get one:

```caddyfile
{
  on_demand_tls {
    ask http://papermark:3000/api/domains/caddy-ask
  }
}

# The app's own hostname: a normal certificate, not on demand.
papermark.example.com {
  reverse_proxy papermark:3000
}

# Every other name: customers' link domains.
https:// {
  tls {
    on_demand
  }
  reverse_proxy papermark:3000
}
```

Adding a domain shows two records to create: the CNAME (or A record) pointing at the install and a TXT record `_papermark-verify.<domain>` that proves the team controls the domain's DNS. The domain is used, and gets a certificate, only once both are in place. Behind a shared proxy or CDN set `CUSTOM_DOMAIN_TARGET_IPS` explicitly; the default (what the CNAME target resolves to) would then match names that don't reach this install.

The server must be reachable from the internet on ports 80 and 443 for Let's Encrypt to issue certificates.

## Verify scripts

Runtime checks next to the code they test (`*.verify.ts[x]`, the repo's existing convention). Each prints `<name>: ok` or exits non-zero.

```sh
TSX="npx tsx --tsconfig oss/tsconfig.verify.json"
$TSX oss/_shared/stubs.verify.tsx                       # no services needed
$TSX oss/_shared/unavailable-pages.verify.tsx           # no services needed
POSTGRES_PRISMA_URL=... UPSTASH_REDIS_REST_URL=... UPSTASH_REDIS_REST_TOKEN=... \
  $TSX oss/features/branding/branding.verify.ts          # migrated Postgres + Redis REST
POSTGRES_PRISMA_URL=... $TSX oss/upstream-gaps.verify.ts  # migrated Postgres
GOTENBERG_URL=... POSTGRES_PRISMA_URL=... NEXT_PRIVATE_UPLOAD_...=... \
  $TSX oss/features/conversions/conversions.verify.ts file.docx  # + gotenberg/gotenberg:8
POSTGRES_PRISMA_URL=... NEXTAUTH_SECRET=x HANKO_API_KEY=x NEXT_PUBLIC_HANKO_TENANT_ID=x \
  $TSX oss/limits/limits.verify.ts                       # migrated Postgres + `prisma generate`
UPSTASH_REDIS_REST_URL=... UPSTASH_REDIS_REST_TOKEN=... $TSX oss/features/security/rate-limit.verify.ts
NEXT_PUBLIC_UPLOAD_TRANSPORT=s3 NEXT_PRIVATE_UPLOAD_ENDPOINT=... NEXT_PRIVATE_UPLOAD_BUCKET=... \
  NEXT_PRIVATE_UPLOAD_ACCESS_KEY_ID=... NEXT_PRIVATE_UPLOAD_SECRET_ACCESS_KEY=... \
  NEXT_PRIVATE_UPLOAD_FORCE_PATH_STYLE=true $TSX oss/features/storage/storage.verify.ts
```

Jobs layer (real Postgres, no DBOS mocks; each script uses its own schemas and drops them first; it reads `.env.local`):

```sh
for f in oss/jobs/*.verify.ts; do npx tsx --tsconfig oss/tsconfig.jobs.json "$f" || exit 1; done
npx tsc -p oss/tsconfig.jobs.json --noEmit   # upstream call sites type-check against the layer
```

For local services: `postgres:16-alpine` + `npx prisma migrate deploy`; any S3-compatible server (e.g. `chrislusf/seaweedfs server -s3`); `redis` behind `hiett/serverless-redis-http` for the Upstash REST API.
