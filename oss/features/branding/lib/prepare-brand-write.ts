import { Prisma } from "@prisma/client";
import { z } from "zod";

import { validateRedirectUrl } from "@/lib/api/domains/validate-redirect-url";
import {
  teamPlanAllowsCustomWelcomeAndCta,
  teamPlanAllowsLayoutCustomization,
} from "@/lib/billing/team-plan-custom-messaging";
import { getFeatureFlags } from "@/lib/featureFlags";
import { SUPPORTED_LOCALE_CODES } from "@/lib/i18n/locales";

import {
  DataroomCardLayoutSchema,
  DataroomViewerHeaderStyleSchema,
  DataroomViewerLayoutPresetSchema,
} from "./dataroom-viewer-layout";

// Same fields and rules as the team branding route (pages/api/teams/[teamId]/branding.ts).
const brandWriteSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  logo: z.string().nullable().optional(),
  hideLogo: z.boolean().optional(),
  banner: z.string().nullable().optional(),
  brandColor: z.string().nullable().optional(),
  accentColor: z.string().nullable().optional(),
  accentButtonColor: z.string().nullable().optional(),
  applyAccentColorToDataroomView: z.boolean().optional(),
  welcomeMessage: z.string().nullable().optional(),
  customLinkPreviewEnabled: z.boolean().optional(),
  linkPreviewTitle: z.string().nullable().optional(),
  linkPreviewDescription: z.string().nullable().optional(),
  linkPreviewImage: z.string().nullable().optional(),
  linkPreviewFavicon: z.string().nullable().optional(),
  ctaLabel: z.string().nullable().optional(),
  ctaUrl: z.string().nullable().optional(),
  privacyPolicyUrl: z.string().nullable().optional(),
  cardLayout: DataroomCardLayoutSchema.optional(),
  showFolderTree: z.boolean().optional(),
  viewerLayoutPreset: DataroomViewerLayoutPresetSchema.optional(),
  viewerHeaderStyle: DataroomViewerHeaderStyleSchema.optional(),
  hideFolderIconsInMain: z.boolean().optional(),
  defaultLanguage: z
    .string()
    .refine(
      (code) => (SUPPORTED_LOCALE_CODES as readonly string[]).includes(code),
      {
        message: "Unsupported language",
      },
    )
    .optional(),
});

type BrandWriteData = Omit<
  Prisma.BrandUncheckedCreateInput,
  "id" | "teamId" | "name" | "createdAt" | "updatedAt"
> & { name?: string };

type PrepareResult<D> =
  | { ok: true; data: D }
  | {
      ok: false;
      status: number;
      message: string;
      errors?: Record<string, string[] | undefined>;
    };

const MESSAGING_FIELDS = [
  "welcomeMessage",
  "ctaLabel",
  "ctaUrl",
  "customLinkPreviewEnabled",
  "linkPreviewTitle",
  "linkPreviewDescription",
  "linkPreviewImage",
  "linkPreviewFavicon",
] as const;
const LAYOUT_FIELDS = [
  "cardLayout",
  "showFolderTree",
  "viewerLayoutPreset",
  "viewerHeaderStyle",
  "hideFolderIconsInMain",
] as const;

/**
 * Validates a team-brand create/update payload. Fields the plan can't set are
 * dropped; absent fields stay absent (so an update leaves them unchanged).
 */
export async function prepareBrandWrite(args: {
  body: unknown;
  teamId: string;
  plan: string;
  nameRequired: true;
}): Promise<PrepareResult<BrandWriteData & { name: string }>>;
export async function prepareBrandWrite(args: {
  body: unknown;
  teamId: string;
  plan: string;
  nameRequired?: false;
}): Promise<PrepareResult<BrandWriteData>>;
export async function prepareBrandWrite({
  body,
  teamId,
  plan,
  nameRequired = false,
}: {
  body: unknown;
  teamId: string;
  plan: string;
  nameRequired?: boolean;
}): Promise<PrepareResult<BrandWriteData>> {
  const parsed = brandWriteSchema.safeParse(body);
  if (!parsed.success) {
    return {
      ok: false,
      status: 400,
      message: "Invalid request body",
      errors: parsed.error.flatten().fieldErrors,
    };
  }
  const input = parsed.data;
  if (nameRequired && !input.name) {
    return { ok: false, status: 400, message: "Brand name is required" };
  }

  const data: Record<string, unknown> = { ...input };

  if (!teamPlanAllowsCustomWelcomeAndCta(plan)) {
    for (const field of MESSAGING_FIELDS) delete data[field];
  } else if (typeof input.ctaUrl === "string" && input.ctaUrl.trim()) {
    const validation = await validateRedirectUrl(input.ctaUrl, teamId);
    if (!validation.valid) {
      return { ok: false, status: 400, message: validation.message };
    }
    data.ctaUrl = validation.url;
  }
  if (!teamPlanAllowsLayoutCustomization(plan)) {
    for (const field of LAYOUT_FIELDS) delete data[field];
  }

  if (input.privacyPolicyUrl !== undefined) {
    const flags = await getFeatureFlags({ teamId });
    const trimmed = input.privacyPolicyUrl?.trim() ?? "";
    if (!flags.customPrivacyUrl) {
      delete data.privacyPolicyUrl;
    } else if (!trimmed) {
      data.privacyPolicyUrl = null;
    } else {
      const validation = await validateRedirectUrl(trimmed, teamId);
      if (!validation.valid) {
        return {
          ok: false,
          status: 400,
          message: validation.message.replace(
            "Redirect URL",
            "Privacy policy URL",
          ),
        };
      }
      data.privacyPolicyUrl = validation.url || null;
    }
  }

  return { ok: true, data: data as BrandWriteData };
}
