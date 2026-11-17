import { PlanEnum } from "./constants";

type PlanPrice = {
  amount: number;
  amountUsd?: number;
  priceIds: {
    test: Record<string, string>;
    production: Record<string, string>;
  } & Record<string, any>;
};

export type Plan = {
  name: PlanEnum | string;
  slug: string;
  price: { monthly: PlanPrice; yearly: PlanPrice };
};

const free = (): PlanPrice => ({
  amount: 0,
  amountUsd: 0,
  priceIds: { test: {}, production: {} },
});

/** No billing when self-hosted: every plan is free and has no Stripe price IDs. */
export const PLANS: Plan[] = Object.values(PlanEnum).map((name) => ({
  name,
  slug: name.toLowerCase().replace(/ /g, "-"),
  price: { monthly: free(), yearly: free() },
}));

export function isOldAccount(plan?: string | null): boolean {
  return !!plan?.includes("+old");
}
