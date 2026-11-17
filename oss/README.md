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

## Verify scripts

Runtime checks next to the code they test (`*.verify.ts[x]`, the repo's existing convention). Each prints `<name>: ok` or exits non-zero.

```sh
TSX="npx tsx --tsconfig oss/tsconfig.verify.json"
$TSX oss/_shared/stubs.verify.tsx                       # no services needed
POSTGRES_PRISMA_URL=... $TSX oss/limits/limits.verify.ts  # migrated Postgres
UPSTASH_REDIS_REST_URL=... UPSTASH_REDIS_REST_TOKEN=... $TSX oss/features/security/rate-limit.verify.ts
NEXT_PUBLIC_UPLOAD_TRANSPORT=s3 NEXT_PRIVATE_UPLOAD_ENDPOINT=... NEXT_PRIVATE_UPLOAD_BUCKET=... \
  NEXT_PRIVATE_UPLOAD_ACCESS_KEY_ID=... NEXT_PRIVATE_UPLOAD_SECRET_ACCESS_KEY=... \
  NEXT_PRIVATE_UPLOAD_FORCE_PATH_STYLE=true $TSX oss/features/storage/storage.verify.ts
```

For local services: `postgres:16-alpine` + `npx prisma migrate deploy`; any S3-compatible server (e.g. `chrislusf/seaweedfs server -s3`); `redis` behind `hiett/serverless-redis-http` for the Upstash REST API.
