/**
 * Runtime check for the AGPL-side files missing from upstream's public repo
 * (lib/api/errors, lib/oauth/scopes, lib/api/auth/restricted-tokens,
 * lib/dataroom/apply-default-permissions, lib/dataroom/index-generator).
 * Needs a migrated Postgres:
 *   POSTGRES_PRISMA_URL=... npx tsx --tsconfig oss/tsconfig.verify.json oss/upstream-gaps.verify.ts
 */
import type { NextApiResponse } from "next";

import { ItemType, RootItemAccess } from "@prisma/client";

import {
  parseRestrictedTokenSubjectType,
  revokeUserBoundTeamTokens,
} from "@/lib/api/auth/restricted-tokens";
import { PapermarkApiError } from "@/lib/api/errors";
import { applyDataroomDocumentPermissionDefaults } from "@/lib/dataroom/apply-default-permissions";
import { generateDataroomIndex } from "@/lib/dataroom/index-generator";
import { errorhandler } from "@/lib/errorHandler";
import { GRANULAR_SCOPES, PRESET_SCOPES } from "@/lib/oauth/scopes";
import prisma from "@/lib/prisma";

import { RESOURCE_OPTIONS } from "@/components/tokens/scopes";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function main() {
  // errors: the shared errorhandler returns the API error's status and message.
  let sent = { status: 0, body: "" };
  const res = {
    status(code: number) {
      sent.status = code;
      return this;
    },
    end(body: string) {
      sent.body = body;
      return this;
    },
    json() {
      return this;
    },
  } as unknown as NextApiResponse;
  errorhandler(new PapermarkApiError("unprocessable_entity", "Bad URL"), res);
  assert(sent.status === 422 && sent.body === "Bad URL", "422 with message");

  // scopes: every action the token editor offers is an accepted scope.
  for (const option of RESOURCE_OPTIONS) {
    for (const action of option.actions) {
      assert(
        (GRANULAR_SCOPES as readonly string[]).includes(
          `${option.resource}.${action}`,
        ),
        `scope ${option.resource}.${action}`,
      );
    }
  }
  assert(PRESET_SCOPES.includes("apis.all"), "apis.all preset");
  assert(parseRestrictedTokenSubjectType("machine") === "machine", "machine");
  assert(
    parseRestrictedTokenSubjectType("bogus") === "user",
    "unknown -> user",
  );

  const suffix = Date.now().toString(36);
  const user = await prisma.user.create({
    data: { email: `gaps-${suffix}@verify.test` },
  });
  const team = await prisma.team.create({
    data: {
      name: `gaps-${suffix}`,
      users: { create: { userId: user.id, role: "ADMIN" } },
    },
  });
  try {
    // restricted tokens: a removed member loses user keys; machine keys stay.
    const token = (name: string, subjectType: string) =>
      prisma.restrictedToken.create({
        data: {
          name,
          hashedKey: `${name}-${suffix}`,
          partialKey: "pk_…",
          scopes: "apis.all",
          subjectType,
          userId: user.id,
          teamId: team.id,
        },
      });
    await token("user-key", "user");
    await token("machine-key", "machine");
    await revokeUserBoundTeamTokens(user.id, team.id);
    const left = await prisma.restrictedToken.findMany({
      where: { teamId: team.id },
    });
    assert(
      left.length === 1 && left[0].name === "machine-key",
      "only machine key left",
    );

    // default permissions for newly attached documents.
    const dataroom = await prisma.dataroom.create({
      data: { name: "DR", teamId: team.id, pId: `dr_${suffix}` },
    });
    const folder = await prisma.dataroomFolder.create({
      data: { name: "Legal", path: "/legal", dataroomId: dataroom.id },
    });
    const viewerGroup = await prisma.viewerGroup.create({
      data: { name: "Investors", dataroomId: dataroom.id, teamId: team.id },
    });
    const otherGroup = await prisma.viewerGroup.create({
      data: { name: "Advisors", dataroomId: dataroom.id, teamId: team.id },
    });
    const permissionGroup = await prisma.permissionGroup.create({
      data: { name: "Link perms", dataroomId: dataroom.id, teamId: team.id },
    });
    // Folder: Investors may view+download, Advisors have no row (hidden).
    await prisma.viewerGroupAccessControls.create({
      data: {
        groupId: viewerGroup.id,
        itemId: folder.id,
        itemType: ItemType.DATAROOM_FOLDER,
        canView: true,
        canDownload: true,
      },
    });
    await prisma.permissionGroupAccessControls.create({
      data: {
        groupId: permissionGroup.id,
        itemId: folder.id,
        itemType: ItemType.DATAROOM_FOLDER,
        canView: true,
        canDownload: false,
        canDownloadOriginal: false,
      },
    });
    const doc = (name: string) =>
      prisma.document.create({
        data: { name, file: "x", type: "pdf", teamId: team.id },
      });
    const inFolder = await prisma.dataroomDocument.create({
      data: {
        dataroomId: dataroom.id,
        documentId: (await doc("a")).id,
        folderId: folder.id,
      },
    });
    const atRoot = await prisma.dataroomDocument.create({
      data: { dataroomId: dataroom.id, documentId: (await doc("b")).id },
    });

    await applyDataroomDocumentPermissionDefaults({
      dataroomId: dataroom.id,
      dataroomDocuments: [inFolder, atRoot],
      groupStrategy: "INHERIT_FROM_PARENT",
      groupRootItemAccess: RootItemAccess.VIEW_ONLY,
      linkStrategy: "INHERIT_FROM_PARENT",
      linkRootItemAccess: RootItemAccess.HIDDEN,
    });

    const vg = await prisma.viewerGroupAccessControls.findMany({
      where: {
        itemType: ItemType.DATAROOM_DOCUMENT,
        group: { dataroomId: dataroom.id },
      },
    });
    const vgRow = (groupId: string, itemId: string) =>
      vg.find((r) => r.groupId === groupId && r.itemId === itemId);
    assert(
      vgRow(viewerGroup.id, inFolder.id)?.canDownload === true &&
        !vgRow(otherGroup.id, inFolder.id),
      "folder document copies the folder's group rows",
    );
    assert(
      vgRow(viewerGroup.id, atRoot.id)?.canView === true &&
        vgRow(viewerGroup.id, atRoot.id)?.canDownload === false &&
        vgRow(otherGroup.id, atRoot.id)?.canView === true,
      "root document gets VIEW_ONLY for every group",
    );
    const pg = await prisma.permissionGroupAccessControls.findMany({
      where: {
        itemType: ItemType.DATAROOM_DOCUMENT,
        groupId: permissionGroup.id,
      },
    });
    assert(
      pg.length === 1 && pg[0].itemId === inFolder.id && pg[0].canView,
      "link permissions: folder rows copied, HIDDEN root gets none",
    );

    // Hidden strategy writes nothing; re-applying never duplicates.
    const extra = await prisma.dataroomDocument.create({
      data: { dataroomId: dataroom.id, documentId: (await doc("c")).id },
    });
    await applyDataroomDocumentPermissionDefaults({
      dataroomId: dataroom.id,
      dataroomDocuments: [extra, inFolder],
      groupStrategy: "HIDDEN_BY_DEFAULT",
      groupRootItemAccess: RootItemAccess.VIEW_AND_DOWNLOAD,
      linkStrategy: "ASK_EVERY_TIME",
      linkRootItemAccess: RootItemAccess.VIEW_AND_DOWNLOAD,
    });
    assert(
      (await prisma.viewerGroupAccessControls.count({
        where: { itemId: extra.id },
      })) === 0,
      "HIDDEN_BY_DEFAULT writes no rows",
    );

    // index generator accepts the DataroomIndexSource the routes build.
    const index = await generateDataroomIndex(
      {
        id: "link",
        dataroom: {
          id: dataroom.id,
          name: "DR",
          createdAt: new Date(),
          lastUpdatedAt: new Date(),
          folders: [folder],
          documents: [
            {
              id: inFolder.id,
              folderId: folder.id,
              orderIndex: null,
              updatedAt: new Date(),
              createdAt: new Date(),
              hierarchicalIndex: null,
              document: {
                id: inFolder.documentId,
                name: "a.pdf",
                versions: [
                  {
                    id: "v1",
                    versionNumber: 1,
                    type: "application/pdf",
                    hasPages: true,
                    file: "x",
                    fileSize: 2048,
                    isVertical: true,
                    numPages: 3,
                    updatedAt: new Date(),
                  },
                ],
              },
            },
          ],
        },
      },
      { format: "excel" },
    );
    assert(
      index.data.length > 1000 && /\.xlsx$/.test(index.filename),
      "excel index",
    );
  } finally {
    await prisma.team.delete({ where: { id: team.id } });
    await prisma.user.delete({ where: { id: user.id } });
    await prisma.$disconnect();
  }
  console.log("upstream-gaps.verify: ok");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
