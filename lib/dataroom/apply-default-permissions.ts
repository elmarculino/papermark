// [fork] Missing from upstream's public repo. Applies a data room's default
// access to documents added to it, mirroring what the folders route does for
// new folders (pages/api/teams/[teamId]/datarooms/[id]/folders/index.ts).
import {
  DefaultPermissionStrategy,
  ItemType,
  RootItemAccess,
} from "@prisma/client";

import { revalidateLinksForDataroom } from "@/lib/api/links/revalidate";
import { resolveRootItemAccessFlags } from "@/lib/dataroom/root-item-access";
import prisma from "@/lib/prisma";

type AttachedDocument = { id: string; folderId: string | null };

/**
 * Writes access-control rows for `dataroomDocuments` (DataroomDocument ids) for
 * every viewer group and every link permission group of the data room.
 *
 * - INHERIT_FROM_PARENT: a document in a folder copies that folder's rows; a
 *   root-level document gets the root-item access (no rows for HIDDEN).
 * - ASK_EVERY_TIME / HIDDEN_BY_DEFAULT: no rows, so the document stays hidden
 *   from group-restricted links until permissions are set explicitly.
 * Existing rows are never overwritten.
 */
export async function applyDataroomDocumentPermissionDefaults({
  dataroomId,
  dataroomDocuments,
  groupStrategy,
  groupRootItemAccess,
  linkStrategy,
  linkRootItemAccess,
}: {
  dataroomId: string;
  dataroomDocuments: AttachedDocument[];
  groupStrategy: DefaultPermissionStrategy;
  groupRootItemAccess: RootItemAccess;
  linkStrategy: DefaultPermissionStrategy;
  linkRootItemAccess: RootItemAccess;
}): Promise<void> {
  if (dataroomDocuments.length === 0) return;

  const groupInherits =
    groupStrategy === DefaultPermissionStrategy.INHERIT_FROM_PARENT;
  const linkInherits =
    linkStrategy === DefaultPermissionStrategy.INHERIT_FROM_PARENT;
  if (!groupInherits && !linkInherits) return;

  const folderIds = Array.from(
    new Set(
      dataroomDocuments
        .map((doc) => doc.folderId)
        .filter((id): id is string => !!id),
    ),
  );
  const rootDocs = dataroomDocuments.filter((doc) => !doc.folderId);
  const folderDocs = dataroomDocuments.filter((doc) => !!doc.folderId);

  await Promise.all([
    groupInherits &&
      (async () => {
        const [groups, parentRows] = await Promise.all([
          prisma.viewerGroup.findMany({
            where: { dataroomId },
            select: { id: true },
          }),
          folderIds.length
            ? prisma.viewerGroupAccessControls.findMany({
                where: {
                  itemId: { in: folderIds },
                  itemType: ItemType.DATAROOM_FOLDER,
                  group: { dataroomId },
                },
                select: {
                  groupId: true,
                  itemId: true,
                  canView: true,
                  canDownload: true,
                },
              })
            : [],
        ]);
        const rootFlags = resolveRootItemAccessFlags(groupRootItemAccess);
        const data = [
          ...folderDocs.flatMap((doc) =>
            parentRows
              .filter((row) => row.itemId === doc.folderId)
              .map((row) => ({
                groupId: row.groupId,
                itemId: doc.id,
                itemType: ItemType.DATAROOM_DOCUMENT,
                canView: row.canView,
                canDownload: row.canDownload,
              })),
          ),
          ...(rootFlags
            ? rootDocs.flatMap((doc) =>
                groups.map((group) => ({
                  groupId: group.id,
                  itemId: doc.id,
                  itemType: ItemType.DATAROOM_DOCUMENT,
                  ...rootFlags,
                })),
              )
            : []),
        ];
        if (data.length) {
          await prisma.viewerGroupAccessControls.createMany({
            data,
            skipDuplicates: true,
          });
        }
      })(),
    linkInherits &&
      (async () => {
        const [groups, parentRows] = await Promise.all([
          prisma.permissionGroup.findMany({
            where: { dataroomId },
            select: { id: true },
          }),
          folderIds.length
            ? prisma.permissionGroupAccessControls.findMany({
                where: {
                  itemId: { in: folderIds },
                  itemType: ItemType.DATAROOM_FOLDER,
                  group: { dataroomId },
                },
                select: {
                  groupId: true,
                  itemId: true,
                  canView: true,
                  canDownload: true,
                  canDownloadOriginal: true,
                },
              })
            : [],
        ]);
        const rootFlags = resolveRootItemAccessFlags(linkRootItemAccess);
        const data = [
          ...folderDocs.flatMap((doc) =>
            parentRows
              .filter((row) => row.itemId === doc.folderId)
              .map((row) => ({
                groupId: row.groupId,
                itemId: doc.id,
                itemType: ItemType.DATAROOM_DOCUMENT,
                canView: row.canView,
                canDownload: row.canDownload,
                canDownloadOriginal: row.canDownloadOriginal,
              })),
          ),
          ...(rootFlags
            ? rootDocs.flatMap((doc) =>
                groups.map((group) => ({
                  groupId: group.id,
                  itemId: doc.id,
                  itemType: ItemType.DATAROOM_DOCUMENT,
                  ...rootFlags,
                })),
              )
            : []),
        ];
        if (data.length) {
          await prisma.permissionGroupAccessControls.createMany({
            data,
            skipDuplicates: true,
          });
        }
      })(),
  ]);
}

/**
 * Hook for every path that attaches documents to a data room: applies the data
 * room's stored defaults, then refreshes cached pages of group-restricted links
 * in the background via `schedule` (e.g. `waitUntil`).
 */
export async function onDataroomDocumentsAttached({
  dataroomId,
  dataroomDocuments,
  schedule,
}: {
  dataroomId: string;
  dataroomDocuments: AttachedDocument[];
  schedule?: (promise: Promise<unknown>) => void;
}): Promise<void> {
  const dataroom = await prisma.dataroom.findUnique({
    where: { id: dataroomId },
    select: {
      defaultPermissionStrategy: true,
      defaultGroupPermissionStrategy: true,
      defaultRootItemAccess: true,
      defaultGroupRootItemAccess: true,
    },
  });
  if (!dataroom) return;

  await applyDataroomDocumentPermissionDefaults({
    dataroomId,
    dataroomDocuments,
    groupStrategy: dataroom.defaultGroupPermissionStrategy,
    groupRootItemAccess: dataroom.defaultGroupRootItemAccess,
    linkStrategy: dataroom.defaultPermissionStrategy,
    linkRootItemAccess: dataroom.defaultRootItemAccess,
  });

  const revalidate = revalidateLinksForDataroom(dataroomId);
  if (schedule) schedule(revalidate);
  else await revalidate;
}
