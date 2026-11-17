/**
 * Runtime check for the branding module. Needs a migrated Postgres and the
 * Upstash REST env (brand logo cache):
 *   POSTGRES_PRISMA_URL=... UPSTASH_REDIS_REST_URL=... UPSTASH_REDIS_REST_TOKEN=... \
 *   npx tsx --tsconfig oss/tsconfig.verify.json oss/features/branding/branding.verify.ts
 */
import { autoFillHasBrandAssets } from "@/ee/features/branding/lib/auto-fill-result";
import { resolveBrandLogo } from "@/ee/features/branding/lib/brand-logo";
import { classifyDataroomBanner } from "@/ee/features/branding/lib/dataroom-banner";
import { getDataroomPreviewDataset } from "@/ee/features/branding/lib/dataroom-preview-presets";
import {
  DATAROOM_LAYOUT_PRESETS,
  asDataroomCardLayout,
  asDataroomViewerHeaderStyle,
  inferDataroomViewerLayoutPreset,
} from "@/ee/features/branding/lib/dataroom-viewer-layout";
import { deleteTeamBrand } from "@/ee/features/branding/lib/delete-team-brand";
import { prepareBrandWrite } from "@/ee/features/branding/lib/prepare-brand-write";
import {
  findDefaultBrand,
  persistDefaultBrand,
  resolveBaseBrand,
  resolveDefaultBrandId,
  resolveOwnedBrandId,
  teamBrandViewerSelect,
} from "@/ee/features/branding/lib/resolve-base-brand";
import {
  inheritsTeamBrand,
  resolveDisplayedDataroomBrand,
} from "@/ee/features/branding/lib/resolve-dataroom-displayed-brand";
import { resolvePublicLinkMeta } from "@/ee/features/branding/lib/resolve-public-link-meta";
import { nextTeamBrandName } from "@/ee/features/branding/lib/team-brands";
import { upsertDataroomBrandAndClearInherited } from "@/ee/features/branding/lib/upsert-dataroom-brand";

import prisma from "@/lib/prisma";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function pureChecks() {
  // Layout presets round-trip through inference; anything else is CUSTOM.
  for (const [id, settings] of Object.entries(DATAROOM_LAYOUT_PRESETS)) {
    assert(inferDataroomViewerLayoutPreset(settings) === id, `preset ${id}`);
  }
  assert(
    inferDataroomViewerLayoutPreset({
      cardLayout: "GRID",
      showFolderTree: true,
      viewerHeaderStyle: "SPLIT",
      hideFolderIconsInMain: true,
    }) === "CUSTOM",
    "unmatched settings are CUSTOM",
  );
  assert(asDataroomCardLayout("bogus") === "LIST", "card layout fallback");
  assert(asDataroomViewerHeaderStyle("SPLIT") === "SPLIT", "header style");

  assert(
    resolveBrandLogo({ logo: "x.png", hideLogo: true }).kind === "none",
    "hidden logo",
  );
  const custom = resolveBrandLogo({ logo: "x.png" });
  assert(custom.kind === "custom" && custom.src === "x.png", "custom logo");
  assert(resolveBrandLogo(null).kind === "papermark", "default logo");

  assert(classifyDataroomBanner("no-banner").kind === "none", "no-banner");
  assert(classifyDataroomBanner("").kind === "none", "empty banner");
  const yt = classifyDataroomBanner(
    "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
  );
  assert(yt.kind === "youtube" && yt.youtubeId === "dQw4w9WgXcQ", "youtube");
  assert(
    classifyDataroomBanner("https://youtu.be/dQw4w9WgXcQ").kind === "youtube",
    "youtu.be",
  );
  assert(
    classifyDataroomBanner("https://cdn.x/clip.mp4").kind === "video",
    "video",
  );
  assert(
    classifyDataroomBanner("/_static/banner.png").kind === "image",
    "image",
  );

  assert(
    !autoFillHasBrandAssets({ banner: "b" }, { allowBanner: false }),
    "banner not allowed",
  );
  assert(
    autoFillHasBrandAssets({ banner: "b" }, { allowBanner: true }),
    "banner allowed",
  );

  // Link or data room picks a team brand -> team brand; else own brand if any.
  assert(
    inheritsTeamBrand({ linkBrandId: "b", hasDataroomBrand: true }),
    "link brand",
  );
  assert(
    inheritsTeamBrand({ dataroomBrandId: "b", hasDataroomBrand: true }),
    "dataroom team brand",
  );
  assert(!inheritsTeamBrand({ hasDataroomBrand: true }), "own dataroom brand");
  assert(inheritsTeamBrand({ hasDataroomBrand: false }), "no own brand");

  const merged = resolveDisplayedDataroomBrand({
    dataroomBrand: { logo: "d.png", hideLogo: null, accentButtonColor: null },
    teamBrand: {
      hideLogo: true,
      accentButtonColor: "#123456",
      privacyPolicyUrl: "https://p",
    },
    inheritTeamBrand: false,
  }) as Record<string, unknown>;
  assert(
    merged.logo === "d.png" &&
      merged.hideLogo === true &&
      merged.accentButtonColor === "#123456" &&
      merged.privacyPolicyUrl === "https://p",
    `null fields inherit from the team brand: ${JSON.stringify(merged)}`,
  );

  const link = {
    enableCustomMetatag: false,
    metaTitle: null,
    metaDescription: null,
    metaImage: null,
    metaFavicon: null,
  };
  const branded = resolvePublicLinkMeta({
    link,
    teamBrand: { customLinkPreviewEnabled: true, linkPreviewTitle: "Team" },
    dataroomBrand: null,
    defaultTitle: "Default",
  });
  assert(
    branded.enableCustomMetatag && branded.metaTitle === "Team",
    "brand preview",
  );
  const own = resolvePublicLinkMeta({
    link: { ...link, enableCustomMetatag: true, metaTitle: "Mine" },
    teamBrand: { customLinkPreviewEnabled: true, linkPreviewTitle: "Team" },
    dataroomBrand: null,
    defaultTitle: "Default",
  });
  assert(
    own.metaTitle === "Mine" && own.metaFavicon === "/favicon.ico",
    "link meta wins",
  );
  assert(
    !resolvePublicLinkMeta({
      link,
      teamBrand: null,
      dataroomBrand: null,
      defaultTitle: "D",
    }).enableCustomMetatag,
    "no preview configured",
  );

  assert(
    nextTeamBrandName([{ name: "Default" }]) === "Brand 2",
    "next brand name",
  );
  assert(
    nextTeamBrandName([{ name: "a" }, { name: "Brand 3" }]) === "Brand 4",
    "skip taken",
  );

  const dataset = getDataroomPreviewDataset();
  assert(
    dataset.folders.length > 0 && dataset.documents.length > 0,
    "preview dataset",
  );
  assert(
    dataset.documents.every(
      (d) =>
        d.folderName === null ||
        dataset.folders.some((f) => f.name === d.folderName),
    ),
    "preview documents point at existing folders",
  );
}

async function dbChecks() {
  const suffix = Date.now().toString(36);
  const team = await prisma.team.create({
    data: { name: `branding-${suffix}` },
  });
  const otherTeam = await prisma.team.create({
    data: { name: `other-${suffix}` },
  });
  try {
    assert((await findDefaultBrand(team.id)) === null, "no brand yet");
    assert((await resolveDefaultBrandId(team.id)) === null, "no default id");

    // First save creates the default brand.
    const first = await persistDefaultBrand({
      teamId: team.id,
      create: { teamId: team.id, name: "Default", logo: "a.png" },
      update: { logo: "a.png" },
    });
    assert(
      (await resolveDefaultBrandId(team.id)) === first.id,
      "created brand is default",
    );
    const updated = await persistDefaultBrand({
      teamId: team.id,
      create: { teamId: team.id, name: "Default" },
      update: { brandColor: "#ff0000" },
    });
    assert(
      updated.id === first.id && updated.brandColor === "#ff0000",
      "second save updates",
    );

    const second = await prisma.brand.create({
      data: { teamId: team.id, name: "Second" },
    });
    const foreign = await prisma.brand.create({
      data: { teamId: otherTeam.id, name: "Foreign" },
    });

    assert(
      (await resolveOwnedBrandId(team.id, second.id)) === second.id,
      "own brand id",
    );
    assert(
      (await resolveOwnedBrandId(team.id, foreign.id)) === null,
      "foreign brand id",
    );
    assert(
      (await resolveOwnedBrandId(team.id, null)) === null,
      "null brand id",
    );

    // Precedence: link -> data room -> default; foreign ids ignored.
    const select = { id: true } as const;
    const pick = (
      linkBrandId?: string | null,
      dataroomBrandId?: string | null,
    ) =>
      resolveBaseBrand({
        teamId: team.id,
        linkBrandId,
        dataroomBrandId,
        select,
      });
    assert(
      (await pick(second.id, first.id))?.id === second.id,
      "link brand first",
    );
    assert(
      (await pick(null, second.id))?.id === second.id,
      "then data room brand",
    );
    assert((await pick(null, null))?.id === first.id, "then team default");
    assert(
      (await pick(foreign.id, null))?.id === first.id,
      "foreign link brand ignored",
    );
    const viewer = await resolveBaseBrand({
      teamId: team.id,
      select: teamBrandViewerSelect,
    });
    assert(viewer?.logo === "a.png" && "cardLayout" in viewer, "viewer select");

    // Deleting the default promotes the oldest remaining brand.
    await deleteTeamBrand({ teamId: team.id, brand: first });
    assert(
      (await resolveDefaultBrandId(team.id)) === second.id,
      "default reassigned",
    );
    await deleteTeamBrand({ teamId: team.id, brand: second });
    assert((await resolveDefaultBrandId(team.id)) === null, "no brands left");

    // Saving a data room's own brand switches the data room off its team brand.
    const teamBrand = await prisma.brand.create({
      data: { teamId: team.id, name: "T" },
    });
    const dataroom = await prisma.dataroom.create({
      data: {
        name: "DR",
        teamId: team.id,
        pId: `dr_${suffix}`,
        brandId: teamBrand.id,
      },
    });
    const own = await upsertDataroomBrandAndClearInherited({
      dataroomId: dataroom.id,
      teamId: team.id,
      data: { brandColor: "#00ff00" },
    });
    const after = await prisma.dataroom.findUnique({
      where: { id: dataroom.id },
    });
    assert(
      own.brandColor === "#00ff00" && after?.brandId === null,
      "own brand applied",
    );
    let threw = false;
    try {
      await upsertDataroomBrandAndClearInherited({
        dataroomId: dataroom.id,
        teamId: otherTeam.id,
        data: {},
      });
    } catch {
      threw = true;
    }
    assert(threw, "other teams can't write a data room's brand");

    // Payload validation.
    const ok = await prepareBrandWrite({
      body: { name: " Sales ", cardLayout: "GRID", defaultLanguage: "pt-BR" },
      teamId: team.id,
      plan: "datarooms-unlimited",
      nameRequired: true,
    });
    assert(
      ok.ok && ok.data.name === "Sales" && ok.data.cardLayout === "GRID",
      "valid payload",
    );
    const bad = await prepareBrandWrite({
      body: { cardLayout: "DIAGONAL" },
      teamId: team.id,
      plan: "datarooms-unlimited",
    });
    assert(!bad.ok && bad.status === 400, "invalid layout rejected");
    const noName = await prepareBrandWrite({
      body: {},
      teamId: team.id,
      plan: "datarooms-unlimited",
      nameRequired: true,
    });
    assert(!noName.ok, "name required");
    const freePlan = await prepareBrandWrite({
      body: { welcomeMessage: "hi", cardLayout: "GRID", brandColor: "#000" },
      teamId: team.id,
      plan: "free",
    });
    assert(
      freePlan.ok &&
        !("welcomeMessage" in freePlan.data) &&
        !("cardLayout" in freePlan.data) &&
        freePlan.data.brandColor === "#000",
      "plan-gated fields dropped",
    );
  } finally {
    await prisma.team.deleteMany({
      where: { id: { in: [team.id, otherTeam.id] } },
    });
    await prisma.$disconnect();
  }
}

pureChecks();
dbChecks()
  .then(() => console.log("branding.verify: ok"))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
