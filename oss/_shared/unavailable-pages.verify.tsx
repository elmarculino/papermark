/**
 * Dashboard pages of dropped features must render their notice inside AppLayout
 * (sidebar, mobile nav). AppLayout is replaced by a marker so this runs before the
 * whole app compiles: npx tsx --tsconfig oss/tsconfig.verify.json oss/_shared/unavailable-pages.verify.tsx
 */
import { RouterContext } from "next/dist/shared/lib/router-context.shared-runtime";

import { type ReactNode, createElement } from "react";

import { resolve } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const appLayoutPath = resolve("components/layouts/app.tsx");
require.cache[appLayoutPath] = {
  id: appLayoutPath,
  filename: appLayoutPath,
  loaded: true,
  exports: {
    __esModule: true,
    default: ({ children }: { children: ReactNode }) =>
      createElement("main", { "data-app-layout": "" }, children),
  },
} as unknown as NodeModule;

const dashboardPages = [
  "pages/datarooms/[id]/analytics/index",
  "pages/partners",
  "pages/workflows/index",
  "pages/workflows/new",
  "pages/workflows/[id]",
  "pages/datarooms/[id]/conversations/index",
  "pages/datarooms/[id]/conversations/[conversationId]/index",
  "pages/datarooms/[id]/conversations/faqs/index",
];

// Some page wrappers read the router (e.g. route params).
const router = {
  query: { id: "d", conversationId: "c" },
  pathname: "/",
  asPath: "/",
  push: async () => true,
  replace: async () => true,
  prefetch: async () => {},
  events: { on() {}, off() {} },
};
const withRouter = (el: ReturnType<typeof createElement>) =>
  createElement(RouterContext.Provider, { value: router as any }, el);

for (const page of dashboardPages) {
  const Page = require(resolve(page)).default;
  const html = renderToStaticMarkup(withRouter(createElement(Page)));
  assert(
    /^<main data-app-layout="">.*not available.*<\/main>$/.test(html),
    `${page} must render the notice inside AppLayout, got: ${html}`,
  );
}

// Visitor-facing workflow entry stays without the dashboard layout.
const WorkflowAccessView =
  require("@/ee/features/workflows/components/workflow-access-view").default;
const visitorHtml = renderToStaticMarkup(
  withRouter(createElement(WorkflowAccessView)),
);
assert(
  !visitorHtml.includes("data-app-layout") &&
    visitorHtml.includes("not available"),
  "visitor workflow view has no dashboard layout",
);

console.log("unavailable-pages.verify: ok");
