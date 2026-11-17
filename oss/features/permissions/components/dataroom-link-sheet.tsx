"use client";

import LinkSheet from "@/components/links/link-sheet";

/**
 * Per-item permissions for one link, keyed by item id. Same shape the
 * permission-groups API accepts (pages/api/teams/[teamId]/datarooms/[id]/permission-groups).
 */
export type ItemPermission = Record<
  string,
  {
    view: boolean;
    download: boolean;
    itemType: "DATAROOM_DOCUMENT" | "DATAROOM_FOLDER";
  }
>;

/**
 * Create/edit sheet for data-room links. The AGPL LinkSheet already handles
 * DATAROOM_LINK (settings, groups, saving). Per-folder access is managed with
 * viewer groups; a per-link permissions step is not provided in this fork.
 */
export function DataroomLinkSheet(props: Parameters<typeof LinkSheet>[0]) {
  return <LinkSheet {...props} />;
}
