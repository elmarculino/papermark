import AppLayout from "@/components/layouts/app";

import { FeatureUnavailablePage } from "./stub";

/** Dashboard page for a dropped feature: the notice inside the normal app layout (sidebar, mobile nav). */
export function FeatureUnavailableAppPage(_props: Record<string, unknown>) {
  return (
    <AppLayout>
      <FeatureUnavailablePage />
    </AppLayout>
  );
}
