/**
 * Runtime check for stubbed and dropped features: npx tsx oss/_shared/stubs.verify.tsx
 */
import type { NextApiRequest, NextApiResponse } from "next";

import {
  ViewerChatLayout,
  ViewerChatProvider,
  useViewerChatSafe,
} from "@/ee/features/ai/components/viewer-chat-provider";
import { SUPPORTED_AI_CONTENT_TYPES } from "@/ee/features/ai/lib/trigger";
import {
  isTeamPaused,
  isTeamPausedById,
} from "@/ee/features/billing/cancellation/lib/is-team-paused";
import {
  ConversationSidebarLayout,
  ConversationSidebarProvider,
  useConversationSidebarSafe,
} from "@/ee/features/conversations/components/viewer/conversation-sidebar-provider";
import { useFreezeProgress } from "@/ee/features/dataroom-freeze/lib/swr/use-freeze-progress";
import { SSOLogin } from "@/ee/features/security/sso";
import {
  getDataroomSystemPrompt,
  getDataroomUserPrompt,
} from "@/ee/features/templates/lib/prompts";
import { PlanEnum } from "@/ee/stripe/constants";
import { getPriceIdFromPlan } from "@/ee/stripe/functions/get-price-id-from-plan";
import { PLANS, isOldAccount } from "@/ee/stripe/utils";
import conversationsToggleRoute from "@/pages/api/teams/[teamId]/datarooms/[id]/conversations/toggle-conversations";
import WorkflowsPage from "@/pages/workflows/index";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

async function main() {
  // Providers and layout wrappers of dropped features must keep rendering the viewer.
  const html = renderToStaticMarkup(
    <ConversationSidebarProvider>
      <ViewerChatProvider enabled documentId="d">
        <ViewerChatLayout>
          <ConversationSidebarLayout>
            <p id="viewer">document</p>
          </ConversationSidebarLayout>
        </ViewerChatLayout>
      </ViewerChatProvider>
    </ConversationSidebarProvider>,
  );
  assert(
    html === '<p id="viewer">document</p>',
    `wrappers must pass children through, got ${html}`,
  );
  assert(
    renderToStaticMarkup(<SSOLogin autoExpand />) === "",
    "SSO login renders nothing",
  );
  assert(
    useViewerChatSafe() === null && useConversationSidebarSafe() === null,
    "no chat/sidebar context",
  );
  assert(
    useFreezeProgress({}).isArchiveInProgress === false,
    "no freeze in progress",
  );
  assert(
    SUPPORTED_AI_CONTENT_TYPES.length === 0,
    "nothing is sent to AI processing",
  );

  // Billing: never paused; Stripe helpers inert.
  assert(
    (await isTeamPaused({})) === false &&
      (await isTeamPausedById("t")) === false,
    "teams are never paused",
  );
  assert(
    getPriceIdFromPlan({ planName: PlanEnum.Pro, period: "monthly" }) === "",
    "no Stripe price IDs",
  );
  assert(
    PLANS.every((p) => p.price.monthly.amount === 0),
    "every plan is free",
  );
  assert(
    isOldAccount("pro+old") && !isOldAccount("pro"),
    "isOldAccount reads the +old suffix",
  );

  // API routes of dropped features answer 404.
  let status = 0;
  const res = {
    status(code: number) {
      status = code;
      return this;
    },
    json() {
      return this;
    },
  } as unknown as NextApiResponse;
  await conversationsToggleRoute({} as NextApiRequest, res);
  assert(status === 404, `dropped API route should 404, got ${status}`);

  // Pages of dropped features render a notice instead of crashing.
  assert(
    renderToStaticMarkup(<WorkflowsPage />).includes("not available"),
    "workflows page shows notice",
  );

  // Templates prompts are real text for the AGPL AI-structure route.
  assert((await getDataroomSystemPrompt()).length > 50, "system prompt");
  assert(
    (await getDataroomUserPrompt("M&A")).includes("M&A"),
    "user prompt includes description",
  );

  // Trigger.dev task IDs must be unique across the app and oss/ stubs.
  const ids = [...walk("lib/trigger"), ...walk("oss")]
    .filter((f) => /\.tsx?$/.test(f))
    .flatMap((f) =>
      [...readFileSync(f, "utf8").matchAll(/\bid: "([a-z0-9-]+)"/g)].map(
        (m) => m[1],
      ),
    );
  const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
  assert(
    dupes.length === 0,
    `duplicate Trigger.dev task ids: ${dupes.join(", ")}`,
  );

  console.log("stubs.verify: ok");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
