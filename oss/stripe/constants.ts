/**
 * Plan names and feature lists. Kept as an interface so plan-gating call sites
 * compile; a self-hosted team always runs on DataRoomsUnlimited.
 */
export enum PlanEnum {
  Pro = "Pro",
  Business = "Business",
  DataRooms = "Data Rooms",
  DataRoomsPlus = "Data Rooms Plus",
  DataRoomsPremium = "Data Rooms Premium",
  DataRoomsUnlimited = "Data Rooms Unlimited",
}

export const PLAN_NAME_MAP: Record<string, string> = {
  free: "Free",
  starter: "Starter",
  pro: "Pro",
  business: "Business",
  datarooms: "Data Rooms",
  "datarooms-plus": "Data Rooms Plus",
  "datarooms-premium": "Data Rooms Premium",
  "datarooms-unlimited": "Data Rooms Unlimited",
};

export type Feature = {
  id: string;
  text: string;
  tooltip?: string;
  aliasIds?: string[];
  isHighlighted?: boolean;
  isNotIncluded?: boolean;
  isUsers?: boolean;
  isCustomDomain?: boolean;
};

export type PlanFeatures = {
  featureIntro: string;
  features: Feature[];
};

export function getPlanFeatures(
  _plan: PlanEnum,
  _options?: {
    period?: "monthly" | "yearly";
    currency?: string;
    highlightFeatures?: string[];
    maxFeatures?: number;
  },
): PlanFeatures {
  return { featureIntro: "Everything included:", features: [] };
}
