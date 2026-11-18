# Fork status

What this fork (`elmarculino/papermark`) runs without Papermark's commercial `ee/` code and
without paid services, what is turned off, and what is still to do. Module-level detail and
the full import map: [`MAP.md`](./MAP.md). Running it: [`README.md`](./README.md).

Last checked: 2026-11-18, on the old-elgin install (`https://papermark.apto`).

## Works (ported or replaced)

| Area | How | Verified |
|---|---|---|
| Documents: upload, page rendering, preview, share links | Upstream code; storage via S3 (SeaweedFS on old-elgin) | ✅ PDF and .docx on old-elgin |
| Office/Keynote → PDF | `oss/features/conversions` → Gotenberg (replaces Papermark's conversion service) | ✅ .docx |
| Background jobs | `oss/jobs/`: DBOS worker in our Postgres, replaces Trigger.dev | ✅ uploads, debounce, crash recovery |
| Email | `lib/resend.ts` over SMTP (OCI Email Delivery on old-elgin), replaces Resend | ✅ login codes |
| Login by email code | NextAuth v4 + Redis (Upstash REST API via `serverless-redis-http`) | ✅ |
| Plans and limits | `oss/stripe`, `oss/limits`: every team gets the top plan, no billing | ✅ |
| Team branding (basic) | `oss/features/branding` | Type-checked, not tested on old-elgin |
| Rate limiting | `oss/features/security` | Type-checked |
| Data room permissions | `oss/features/permissions` (◐: the per-link `PermissionsSheet` is a stub) | Partly |
| Self-host fixes | Own hostname is the app (not a custom domain); first sign-in without QStash; `__Secure-` session cookie on https; `/view` links and labels use the install's host | ✅ old-elgin |
| Docker image | `Dockerfile`: app, jobs worker and migrations from one image | ✅ old-elgin |
| Data room AI structure generator | Upstream route + our prompts (`oss/features/templates/lib/prompts.ts`) | Needs `OPENAI_API_KEY` (not set on old-elgin) |

## Turned off (stub or dropped)

These show "not available" or render nothing. Bringing one back means writing it ourselves.

- **AI:** viewer chat, document AI dialog, agents settings. The AI indexing jobs are no-ops.
- **Conversations, workflows, data room freeze, redaction, templates.**
- **Data room invitations, request lists, partners, access notifications, data room analytics.**
- **SSO:** SAML/SCIM. (The open-source `@boxyhq/saml-jackson` library is still wired in upstream code but not configured.)

## Depends on a paid service we don't run (broken or partial)

| Feature | Needs | Effect today |
|---|---|---|
| View analytics (`/api/record_view`, dashboards) | Tinybird | View tracking fails; dashboard stays empty |
| Custom link domains ("Add Domain") | Vercel domains API | Adding a domain fails |
| Passkeys | Hanko | Button shown, doesn't work |
| Google / LinkedIn login | OAuth apps | Buttons shown, not configured |
| Welcome mail, outgoing webhooks | Upstash QStash | Welcome mail skipped; webhooks fail |
| Visit exports, branding/logo image upload, bulk import, some file helpers | Vercel Blob (`@vercel/blob`) | Not tested; expected to fail without `BLOB_READ_WRITE_TOKEN` |
| Bulk ZIP download | AWS Lambda | Fails |
| Feature flags | Vercel Edge Config | Not checked; likely all off |
| Slack integration | Slack app | Not configured (settings call returns 500) |
| Billing/currency, branding auto-fill | Routes missing from the public repo | 404 (billing UI only) |

## Known issues

- Signing-agreement PDF upload fails on SeaweedFS (`BadDigest`, checksum in the presigned URL).
- A team on the legacy `trial` plan can't convert Office/Keynote files (no `conversion-trial` queue upstream).
- No backups of the old-elgin data (`~/stacks/papermark/data/`).

## Backlog

1. **Vercel Blob → our S3**, so visit exports and image uploads work.
2. **Tinybird → ClickHouse** for view analytics (5 tables, 15 queries).
3. **Feature flags from env** instead of Edge Config.
4. **Passkeys without Hanko** (SimpleWebAuthn, MIT).
5. **Custom link domains without Vercel** (Caddy on-demand TLS + DNS check).
6. **AI port:** text extraction, embeddings in pgvector, viewer chat endpoint.
7. **Email templates:** replace Papermark, Inc. branding and address.
8. **Hide unconfigured login buttons** (Google, LinkedIn, passkey).
9. **Fix the signing upload** on SeaweedFS (drop the checksum from presigned PUTs).
10. **Backups** for the old-elgin data; a Komodo stack for a dedicated server.
