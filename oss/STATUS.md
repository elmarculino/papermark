# Fork status

What this fork (`elmarculino/papermark`) runs without Papermark's commercial `ee/` code and
without paid services, what is turned off, and what is still to do. The fork holds only what
self-hosting Papermark without paid services needs; document-management features (OCR,
search, activity log, versions, trash, backups, AI over documents) live in
[`elmarculino/acervo`](https://github.com/elmarculino/acervo), which pulls this fork's `main`. Module-level detail and
the full import map: [`MAP.md`](./MAP.md). Running it: [`README.md`](./README.md).

Last checked: 2026-11-18, on the old-elgin install (`https://papermark.apto`).

## Works (ported or replaced)

| Area                                                    | How                                                                                                                                                                       | Verified                                                                |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Documents: upload, page rendering, preview, share links | Upstream code; storage via S3 (SeaweedFS on old-elgin)                                                                                                                    | ✅ PDF and .docx on old-elgin                                           |
| Office/Keynote → PDF                                    | `oss/features/conversions` → Gotenberg (replaces Papermark's conversion service)                                                                                          | ✅ .docx                                                                |
| Background jobs                                         | `oss/jobs/`: DBOS worker in our Postgres, replaces Trigger.dev                                                                                                            | ✅ uploads, debounce, crash recovery                                    |
| Email                                                   | `lib/resend.ts` over SMTP (OCI Email Delivery on old-elgin), replaces Resend                                                                                              | ✅ login codes                                                          |
| Login by email code                                     | NextAuth v4 + Redis (Upstash REST API via `serverless-redis-http`)                                                                                                        | ✅                                                                      |
| Plans and limits                                        | `oss/stripe`, `oss/limits`: every team gets the top plan, no billing                                                                                                      | ✅                                                                      |
| Team branding (basic)                                   | `oss/features/branding`                                                                                                                                                   | ✅ logo upload, shown to recipients in the viewer                       |
| Public files (logos, preview images, visit exports)     | `oss/blob`: `@vercel/blob` aliased to a public-read S3 bucket (`BLOB_BACKEND=s3`), replaces Vercel Blob                                                                   | ✅ logo upload in the browser; worker write/read/delete on old-elgin    |
| Rate limiting                                           | `oss/features/security`                                                                                                                                                   | Type-checked                                                            |
| Data room permissions                                   | `oss/features/permissions` (◐: the per-link `PermissionsSheet` is a stub)                                                                                                 | Partly                                                                  |
| Self-host fixes                                         | Own hostname is the app (not a custom domain); first sign-in without QStash; `__Secure-` session cookie on https; `/view` links and labels use the install's host         | ✅ old-elgin                                                            |
| Feature flags                                           | `FEATURE_FLAGS` env (comma-separated) when `EDGE_CONFIG` is unset (`lib/featureFlags`), replaces Vercel Edge Config                                                       | Verify script                                                           |
| Login page                                              | Google, LinkedIn and passkey buttons only when their keys are set (`oss/_shared/login-methods.ts`)                                                                        | Dev and production build                                                |
| Email footers                                           | `EMAIL_COMPANY_NAME` / `EMAIL_COMPANY_ADDRESS` instead of Papermark, Inc. (`oss/_shared/email-company.tsx`)                                                               | Verify script (renders 7 emails)                                        |
| Presigned uploads on S3-compatible stores               | `lib/files/aws-client.ts` computes request checksums only when required (SeaweedFS/MinIO reject the default one)                                                          | Verify script on SeaweedFS                                              |
| Outgoing webhooks, data room digests                    | `oss/qstash`: jobs-worker task and schedules when `QSTASH_TOKEN` is unset, replaces QStash; QStash-called routes refuse unsigned calls                                    | Verify scripts (in-process worker, local endpoint)                      |
| Bulk ZIP download                                       | `oss/features/storage/zip-download-batch.ts`: the worker builds the zip (watermarks, folders) when no Lambda is set, replaces AWS Lambda; zips cleaned after 4 days       | Verify script on SeaweedFS (real job end to end)                        |
| Passkeys                                                | `oss/passkeys`: SimpleWebAuthn, `PasskeyCredential` table, challenges in Redis, replaces Hanko                                                                            | Browser with a virtual authenticator                                    |
| Custom link domains                                     | `oss/domains`: DNS + TXT ownership check, `/api/domains/caddy-ask` for Caddy on-demand TLS, replaces the Vercel domains API                                               | Verify script (real DNS), production build; Caddy not yet deployed      |
| View analytics, visit exports, webhook log              | `oss/analytics`: `@chronark/zod-bird` aliased to Postgres tables (schema `papermark_analytics`) and the 15 pipes as SQL, replaces Tinybird (`ANALYTICS_BACKEND=postgres`) | Verify script (every pipe); dashboard after a real visit in the browser |
| Docker image                                            | `Dockerfile`: app, jobs worker and migrations from one image                                                                                                              | ✅ old-elgin                                                            |
| Data room AI structure generator                        | Upstream route + our prompts (`oss/features/templates/lib/prompts.ts`)                                                                                                    | Needs `OPENAI_API_KEY` (not set on old-elgin)                           |

## Turned off (stub or dropped)

These show "not available" or render nothing. Bringing one back means writing it ourselves.

- **AI:** viewer chat, document AI dialog, agents settings. The AI indexing jobs are no-ops.
- **Conversations, workflows, data room freeze, redaction, templates.**
- **Data room invitations, request lists, partners, access notifications, data room analytics.**
- **SSO:** SAML/SCIM. (The open-source `@boxyhq/saml-jackson` library is still wired in upstream code but not configured.)

## Depends on a paid service we don't run (broken or partial)

| Feature                              | Needs                               | Effect today                                          |
| ------------------------------------ | ----------------------------------- | ----------------------------------------------------- |
| Google / LinkedIn login              | OAuth apps                          | Work once the keys are set; buttons hidden until then |
| Welcome mail                         | Upstash QStash                      | Skipped (it is a Papermark marketing mail)            |
| Slack integration                    | Slack app                           | Not configured (settings call returns 500)            |
| Billing/currency, branding auto-fill | Routes missing from the public repo | 404 (billing UI only)                                 |

## Known issues

- A team on the legacy `trial` plan can't convert Office/Keynote files (no `conversion-trial` queue upstream). Not planned: our installs don't use that plan.
- No backups of the old-elgin data (`~/stacks/papermark/data/`).

## Limits to know

- `BLOB_BACKEND` / `ANALYTICS_BACKEND` switch the app build only; the jobs worker always uses the fork's S3 and Postgres versions (its tsconfig aliases are static).
- `NEXT_PUBLIC_APP_BASE_HOST` and `NEXT_PUBLIC_MARKETING_URL` are inlined at build time (put them in `build.env`); with a link host different from the app host, `/view/...` links on the link host are treated as a custom domain.
- The analytics tables (`papermark_analytics`) are created with `CREATE ... IF NOT EXISTS`: a later column or index change needs its own migration step. Rows are not removed when a document, team or webhook is deleted (as with Tinybird).

## Backlog

1. **Caddy on a public server** for custom link domains (config in `README.md`), and a test with a real domain.
2. **Rest of the email branding:** Papermark links and wording inside the templates (the footers are done).
3. **Domain re-checks** as a worker schedule: the daily domain check needs QStash, so a verified domain stays verified if its TXT record is later removed, and an unverified row blocks the name until deleted by hand.
4. **Slack:** configuration only; document it in the README.
5. **A Komodo stack** for a dedicated server.

Moved to Acervo: the AI port (it builds on Acervo's text extraction) and backups as a feature.
