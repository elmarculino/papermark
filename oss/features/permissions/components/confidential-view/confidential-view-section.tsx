import { useEffect, useState } from "react";

import type { DEFAULT_LINK_TYPE } from "@/components/links/link-sheet";
import LinkItem from "@/components/links/link-sheet/link-item";
import type { LinkUpgradeOptions } from "@/components/links/link-sheet/link-options";

/** Link option: blur the document except a spotlight around the viewer's pointer. */
export default function ConfidentialViewSection({
  data,
  setData,
  isAllowed,
  handleUpgradeStateChange,
}: {
  data: DEFAULT_LINK_TYPE;
  setData: React.Dispatch<React.SetStateAction<DEFAULT_LINK_TYPE>>;
  isAllowed: boolean;
  handleUpgradeStateChange: (options: LinkUpgradeOptions) => void;
}) {
  const [enabled, setEnabled] = useState<boolean>(
    !!data.enableConfidentialView,
  );

  useEffect(() => {
    setEnabled(!!data.enableConfidentialView);
  }, [data.enableConfidentialView]);

  const toggle = () => {
    const next = !enabled;
    setData({ ...data, enableConfidentialView: next });
    setEnabled(next);
  };

  return (
    <div className="pb-5">
      <LinkItem
        title="Confidential view"
        tooltipContent="Blur the document except the area around the viewer's pointer, to deter shoulder-surfing and full-page screenshots."
        enabled={enabled}
        action={toggle}
        isAllowed={isAllowed}
        requiredPlan="business"
        upgradeAction={() =>
          handleUpgradeStateChange({
            state: true,
            trigger: "link_sheet_confidential_view_section",
            plan: "Business",
            highlightItem: ["confidential"],
          })
        }
      />
    </div>
  );
}
