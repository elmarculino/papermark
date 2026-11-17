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

| Path | Kind |
|---|---|
| `stripe/`, `limits/` | Stub. Every team is on the top plan with no limits. Kept as an interface in case of future SaaS work. |
