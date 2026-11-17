# ee/ replacement map

Upstream base: `papermark/papermark@ed19717` (2026-08-28). There are 104 distinct `@/ee/...` modules, imported by about 190 AGPL files.

## Approach

- `ee/` and `app/(ee)/` are deleted. `tsconfig.json` maps `@/ee/*` → `./oss/*`, so **call sites stay identical to upstream** and merges from upstream don't conflict.
- Each module gets one of three treatments: **real** code we write, a **stub** with the same interface, or **drop** (stub that renders nothing, plus delete the feature's own pages and routes).
- Clean-room: interfaces come only from AGPL call sites and public library docs. Nothing is copied from `ee/`.
- Upstream itself is incomplete: about 49 imports (in `ee/` and in AGPL `lib/`) point at files that are not public. They're listed below too.

## Status

| Module                                                                                                                                                                               | Kind                                 | Status | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------ | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `stripe/*`, `limits/*`                                                                                                                                                               | stub                                 | ✅     | Every team gets the `datarooms-unlimited` plan: `Team.plan` now defaults to it (schema + migration), and `canCreateUnlimitedTeam → true`. Added `pages/api/teams/[teamId]/billing/plan.ts` for `usePlan()` (missing upstream). Numeric limits are `Infinity`, except `datarooms` (`MAX_SAFE_INTEGER`) and `linkCustomFields` (20), where client code treats `null` as a small cap. File-size caps keep upstream's paid-plan defaults. Kept as an interface for possible SaaS work later.       |
| `features/billing`                                                                                                                                                                   | stub                                 | ✅     | `isTeamPaused*` → `false`; trial and pause Trigger.dev tasks are no-ops; pause/unpause API routes return 404; `CancellationModal` renders nothing                                                                                                                                                                                                                                                                                                                                              |
| `features/storage`                                                                                                                                                                   | real                                 | ✅     | Env-driven S3 config with a single region, plus a tus `S3Store`. New env: `NEXT_PRIVATE_UPLOAD_FORCE_PATH_STYLE` (MinIO/Garage), `NEXT_PRIVATE_ADVANCED_UPLOAD_BUCKET`, `NEXT_PRIVATE_DOWNLOAD_LAMBDA_FUNCTION_NAME`. **Bulk ZIP download still needs AWS Lambda** and has to be replaced to run elsewhere.                                                                                                                                                                                    |
| `features/security`                                                                                                                                                                  | real (rate limit) + drop (SAML/SCIM) | ✅     | `checkRateLimit`/`rateLimiters` on `lib/redis` `ratelimit()`, failing open if Redis is down. SSO components render nothing; `JACKSON_PRODUCT` constant kept for `lib/jackson.ts`                                                                                                                                                                                                                                                                                                               |
| `features/branding`                                                                                                                                                                  | real (minimal)                       | ⏳     | Not public upstream. 29 importers. Logo + colors; advanced layout options as stubs                                                                                                                                                                                                                                                                                                                                                                                                             |
| `features/permissions`                                                                                                                                                               | real                                 | ⏳     | Per-item data-room permissions, confidential view                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `features/conversions`                                                                                                                                                               | real                                 | ⏳     | Office/Keynote → PDF via Gotenberg                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `features/dataroom-invitations`                                                                                                                                                      | stub (rewrite later?)                | ✅     | Invite buttons show a "not available" toast and the modal closes; invite APIs 404; `invitationEmailSchema` is a real email check. Could be rewritten later (simple).                                                                                                                                                                                                                                                                                                                           |
| `features/request-lists`, `partners`, `access-notifications`, `dataroom-analytics`                                                                                                   | stub                                 | ✅     | Feature hooks return `false` (sidebar hides Tasks), viewer UI renders nothing, `isViewerAssigned` → `false`: task-only uploads on links without uploads enabled are refused (no AGPL code creates tasks anyway). Partners: referral link hidden, page shows notice. Access notifications: denied access is still denied, just not reported. Data-room analytics page shows notice. Dropped dashboard pages (analytics, partners, workflows, conversations) show the notice inside `AppLayout`. |
| `features/ai`, `conversations`, `workflows`, `dataroom-freeze`, `templates`, `redaction`                                                                                             | drop                                 | ✅     | Providers and layouts pass children through; buttons, dialogs and panels render nothing; pages show "not available"; API routes 404; Trigger.dev tasks are no-ops with `oss-noop-*` IDs. Templates: `FolderTemplate` type plus our own prompts, so the AGPL AI-structure route still works                                                                                                                                                                                                     |
| AGPL-side gaps: `lib/api/errors`, `lib/dataroom/apply-default-permissions`, `lib/api/auth/restricted-tokens`, `lib/oauth/scopes`, `lib/dataroom/index-generator#DataroomIndexSource` | real                                 | ⏳     | Missing from upstream's public repo                                                                                                                                                                                                                                                                                                                                                                                                                                                            |

## Progress check

```sh
npx tsc --noEmit | grep -c "error TS"          # 380 at fork point, 247 after stripe/limits, 210 after billing/storage/rate-limit, 158 after the drop stubs, 129 after the small-feature stubs
npx tsc --noEmit | grep -oE "Cannot find module '@/ee/[^']+'" | sort -u
```

## Appendix: every `@/ee/...` import (generated)

Generated with the TypeScript compiler API at upstream `ed19717`. Shows `module`: imported names (number of importing files). ✅ = provided in `oss/`.

### features/access-notifications

- ✅ `features/access-notifications`: `reportDeniedAccessAttempt` (2)

### features/ai

- ✅ `features/ai/components/agents-settings-card`: `AgentsSettingsCard` (1)
- ✅ `features/ai/components/document-ai-dialog`: `DocumentAIDialog` (1)
- ✅ `features/ai/components/viewer-chat-panel`: `ViewerChatPanel` (2)
- ✅ `features/ai/components/viewer-chat-provider`: `ViewerChatLayout` (2), `ViewerChatProvider` (2), `useViewerChatSafe` (2)
- ✅ `features/ai/components/viewer-chat-toggle`: `ViewerChatToggle` (2)
- ✅ `features/ai/lib/trigger`: `SUPPORTED_AI_CONTENT_TYPES` (2), `addFileToVectorStoreTask` (2), `processDocumentForAITask` (2)

### features/billing

- ✅ `features/billing/cancellation/api/automatic-unpause-route`: `handleRoute` (1)
- ✅ `features/billing/cancellation/api/send-pause-resume-notification`: `(re-export)` (1)
- ✅ `features/billing/cancellation/components`: `CancellationModal` (1)
- ✅ `features/billing/cancellation/lib/is-team-paused`: `isTeamPaused` (1), `isTeamPausedById` (20)
- ✅ `features/billing/cancellation/lib/trigger/pause-resume-notification`: `sendPauseResumeNotificationTask` (1)
- ✅ `features/billing/cancellation/lib/trigger/unpause-task`: `automaticUnpauseTask` (1)
- ✅ `features/billing/dataroom-trial/lib/trigger/send-scheduled-email`: `sendDataroomTrial24hReminderEmailTask` (1), `sendDataroomTrialExpiredEmailTask` (1), `sendDataroomTrialInfoEmailTask` (1)

### features/branding

- `features/branding/components/banner-editor`: `BannerEditor` (2)
- `features/branding/components/branding-link-preview-form`: `BrandingLinkPreviewForm` (2)
- `features/branding/components/branding-preview-chrome`: `BrandingPreviewChrome` (2)
- `features/branding/components/branding-social-preview-readonly`: `BrandingSocialPreviewReadonly` (1)
- `features/branding/components/collapsible-branding-section`: `CollapsibleBrandingSection` (2)
- `features/branding/components/dataroom-layout-preset-cards`: `DataroomLayoutPresetCards` (2)
- `features/branding/components/team-brand-switcher`: `DRAFT_TEAM_BRAND_ID` (1), `TeamBrandSwitcher` (1), `nextTeamBrandName` (1)
- `features/branding/components/visitor-language-card`: `VisitorLanguageCard` (1)
- `features/branding/lib/auto-fill-result`: `AUTO_FILL_NOT_FOUND_MESSAGE` (2), `autoFillHasBrandAssets` (2)
- `features/branding/lib/brand-logo`: `BrandLogoFields (type)` (1), `ResolvedBrandLogo (type)` (3), `resolveBrandLogo` (7)
- `features/branding/lib/dataroom-banner`: `DataroomBannerKind (type)` (1), `classifyDataroomBanner` (3)
- `features/branding/lib/dataroom-preview-presets`: `getDataroomPreviewDataset` (1)
- `features/branding/lib/dataroom-viewer-layout`: `CARD_LAYOUT_OPTIONS` (2), `DataroomCardLayout (type)` (8), `DataroomCardLayoutSchema` (2), `DataroomLayoutCardId (type)` (2), `DataroomViewerHeaderStyle (type)` (7), `DataroomViewerHeaderStyleSchema` (2), `DataroomViewerLayoutPreset (type)` (2), `DataroomViewerLayoutPresetSchema` (2), `asDataroomCardLayout` (3), `asDataroomViewerHeaderStyle` (4), `inferDataroomViewerLayoutPreset` (2)
- `features/branding/lib/delete-team-brand`: `deleteTeamBrand` (2)
- `features/branding/lib/prepare-brand-write`: `prepareBrandWrite` (2)
- `features/branding/lib/resolve-base-brand`: `findDefaultBrand` (1), `persistDefaultBrand` (1), `resolveBaseBrand` (2), `resolveDefaultBrandId` (5), `resolveOwnedBrandId` (3), `teamBrandOgSelect` (1), `teamBrandViewerSelect` (1), `teamBrandWorkflowSelect` (1)
- `features/branding/lib/resolve-dataroom-displayed-brand`: `CUSTOM_DATAROOM_BRAND` (2), `CUSTOM_DATAROOM_BRAND_LABEL` (2), `inheritsTeamBrand` (1), `resolveDisplayedDataroomBrand` (1)
- `features/branding/lib/resolve-public-link-meta`: `ResolvedPublicLinkMeta (type)` (1), `resolvePublicLinkMeta` (1)
- `features/branding/lib/upsert-dataroom-brand`: `upsertDataroomBrandAndClearInherited` (1)
- `features/branding/lib/use-branding-preview-params`: `useBrandingPreviewParams` (3)
- `features/branding/lib/use-logo-tone`: `useLogoTone` (2)

### features/conversations

- ✅ `features/conversations/api/conversations-route`: `handleRoute` (1)
- ✅ `features/conversations/api/send-conversation-mention-notification`: `(re-export)` (1)
- ✅ `features/conversations/api/send-conversation-new-message-notification`: `default` (1)
- ✅ `features/conversations/api/send-conversation-team-member-notification`: `(re-export)` (1)
- ✅ `features/conversations/api/team-conversations-route`: `handleRoute` (1)
- ✅ `features/conversations/api/team-faqs-route`: `default` (2)
- ✅ `features/conversations/api/team-questions-route`: `handleRoute` (1)
- ✅ `features/conversations/api/toggle-conversations-route`: `default` (1)
- ✅ `features/conversations/components/dashboard/link-option-conversation-section`: `default` (1)
- ✅ `features/conversations/components/viewer/conversation-sidebar-provider`: `ConversationSidebarLayout` (2), `ConversationSidebarProvider` (2), `useConversationSidebarSafe` (2)
- ✅ `features/conversations/components/viewer/conversation-view-sidebar`: `ConversationSidebarProps` (1), `ConversationViewSidebar` (1)
- ✅ `features/conversations/lib/trigger/conversation-message-notification`: `sendConversationMentionNotificationTask` (1), `sendConversationMessageNotificationTask` (1), `sendConversationTeamMemberNotificationTask` (1)
- ✅ `features/conversations/pages/conversation-overview`: `default` (2)
- ✅ `features/conversations/pages/faq-overview`: `(re-export)` (1)

### features/conversions

- `features/conversions/lib/trigger/convert-files`: `convertFilesToPdfTask (type)` (3), `convertKeynoteToPdfTask (type)` (1)

### features/dataroom-analytics

- ✅ `features/dataroom-analytics/pages/dataroom-analytics-page`: `(re-export)` (1)

### features/dataroom-freeze

- ✅ `features/dataroom-freeze/components/freeze-settings`: `default` (1)
- ✅ `features/dataroom-freeze/lib/swr/use-freeze-progress`: `useFreezeProgress` (1)

### features/dataroom-invitations

- ✅ `features/dataroom-invitations/api/group-invite`: `default` (1)
- ✅ `features/dataroom-invitations/api/link-invite`: `default` (1)
- ✅ `features/dataroom-invitations/api/uninvited`: `default` (1)
- ✅ `features/dataroom-invitations/components/invite-viewers-modal`: `InviteViewersModal` (4)
- ✅ `features/dataroom-invitations/lib/schema/dataroom-invitations`: `invitationEmailSchema` (1)
- ✅ `features/dataroom-invitations/lib/swr/use-dataroom-invitations`: `useUninvitedMembers` (1)

### features/partners

- ✅ `features/partners/lib/referrals`: `isReferralsEnabled` (2)
- ✅ `features/partners/pages/partner-program`: `(re-export)` (1)

### features/permissions

- `features/permissions/components/confidential-view/confidential-view-overlay`: `ConfidentialViewOverlay` (7)
- `features/permissions/components/confidential-view/confidential-view-section`: `default` (4)
- `features/permissions/components/dataroom-link-sheet`: `DataroomLinkSheet` (1), `ItemPermission (type)` (1)
- `features/permissions/components/permissions-sheet`: `PermissionsSheet` (1)

### features/redaction

- ✅ `features/redaction/components/redaction-config-dialog`: `(dynamic import)` (1)
- ✅ `features/redaction/components/redaction-jobs-dialog`: `(dynamic import)` (1)
- ✅ `features/redaction/components/redaction-launcher`: `RedactionLauncher` (1)
- ✅ `features/redaction/components/redaction-workspace`: `RedactionWorkspace` (1)

### features/request-lists

- ✅ `features/request-lists/components/request-list-settings-card`: `RequestListSettingsCard` (1)
- ✅ `features/request-lists/components/request-list-view`: `RequestListView` (1)
- ✅ `features/request-lists/components/viewer/request-list-button`: `RequestListButton` (1)
- ✅ `features/request-lists/components/viewer/request-list-sheet`: `RequestListSheet` (1)
- ✅ `features/request-lists/lib/assignments`: `isViewerAssigned` (1)
- ✅ `features/request-lists/lib/events`: `VIEWER_TOGGLE_REQUEST_LIST_EVENT` (1)
- ✅ `features/request-lists/lib/swr/use-viewer-request-list`: `useViewerRequestList` (3)
- ✅ `features/request-lists/lib/use-request-list-feature`: `useRequestListFeatureEnabled` (3)

### features/security

- ✅ `features/security`: `checkRateLimit` (3), `rateLimiters` (3)
- ✅ `features/security/sso`: `DirectorySyncConfigModal` (1), `SAMLConfigModal` (1), `SSOEnforcementToggle` (1), `SSOLogin` (1)
- ✅ `features/security/sso/product`: `(re-export)` (1)

### features/storage

- ✅ `features/storage/config`: `StorageConfig (type)` (2), `getStorageConfig` (1), `getTeamStorageConfigById` (5)
- ✅ `features/storage/s3-store`: `MultiRegionS3Store` (2)

### features/templates

- ✅ `features/templates/api/datarooms/apply-template`: `(re-export)` (1)
- ✅ `features/templates/api/datarooms/generate`: `(re-export)` (1)
- ✅ `features/templates/components/dataroom-templates`: `default` (1)
- ✅ `features/templates/constants/dataroom-templates`: `FolderTemplate` (1)
- ✅ `features/templates/lib/prompts`: `getDataroomSystemPrompt` (1), `getDataroomUserPrompt` (1)

### features/workflows

- ✅ `features/workflows/components/workflow-access-view`: `default` (2)
- ✅ `features/workflows/pages/workflow-detail`: `default` (1)
- ✅ `features/workflows/pages/workflow-new`: `default` (1)
- ✅ `features/workflows/pages/workflow-overview`: `default` (1)

### limits

- ✅ `limits/can-create-premium-team`: `PREMIUM_TEAM_LIMIT` (1), `getPremiumTeamEligibility` (1)
- ✅ `limits/can-create-unlimited-team`: `canCreateUnlimitedTeam` (1)
- ✅ `limits/constants`: `DATAROOMS_PREMIUM_PLAN_LIMITS` (1), `DATAROOMS_UNLIMITED_PLAN_LIMITS` (1)
- ✅ `limits/handler`: `default` (1)
- ✅ `limits/server`: `getLimits` (10)
- ✅ `limits/swr-handler`: `useLimits` (3)

### stripe

- ✅ `stripe`: `cancelSubscription` (1)
- ✅ `stripe/constants`: `Feature` (3), `PLAN_NAME_MAP` (1), `PlanEnum` (65), `getPlanFeatures` (5)
- ✅ `stripe/currency`: `CURRENCY_LABEL` (1), `CURRENCY_SYMBOL` (1), `Currency (type)` (3)
- ✅ `stripe/functions/get-price-id-from-plan`: `getPriceIdFromPlan` (6)
- ✅ `stripe/functions/get-quantity-from-plan`: `getQuantityFromPriceId` (1)
- ✅ `stripe/functions/get-subscription-item`: `SubscriptionDiscount` (1)
- ✅ `stripe/utils`: `PLANS` (6), `isOldAccount` (1)
