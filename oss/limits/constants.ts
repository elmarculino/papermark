/**
 * Self-hosted plan limits. Numeric limits use `Infinity` for "no limit": server-side
 * comparisons (`count >= limit`) never trip, and JSON turns it into `null`, which
 * client call sites already treat as unlimited. Feature flags are all on.
 */
export type FileSizeLimits = Partial<{
  video: number | null;
  document: number | null;
  image: number | null;
  excel: number | null;
  maxFiles: number | null;
  maxPages: number | null;
}>;

export type PlanLimits = {
  documents: number;
  links: number;
  users: number;
  domains: number;
  datarooms: number;
  customDomainOnPro: boolean;
  customDomainInDataroom: boolean;
  advancedLinkControlsOnPro: boolean;
  watermarkOnBusiness: boolean;
  agreementOnBusiness: boolean;
  conversationsInDataroom: boolean;
  linkCustomFields: number;
  dataroomUpload: boolean;
  fileSizeLimits?: FileSizeLimits;
};

export const UNLIMITED_PLAN_LIMITS: PlanLimits = {
  documents: Infinity,
  links: Infinity,
  users: Infinity,
  domains: Infinity,
  datarooms: Infinity,
  customDomainOnPro: true,
  customDomainInDataroom: true,
  advancedLinkControlsOnPro: true,
  watermarkOnBusiness: true,
  agreementOnBusiness: true,
  conversationsInDataroom: false,
  linkCustomFields: Infinity,
  dataroomUpload: true,
};

export const DATAROOMS_UNLIMITED_PLAN_LIMITS = UNLIMITED_PLAN_LIMITS;
export const DATAROOMS_PREMIUM_PLAN_LIMITS = UNLIMITED_PLAN_LIMITS;
