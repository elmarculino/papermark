/** No billing when self-hosted: there are no Stripe price IDs. */
export function getPriceIdFromPlan(_args: {
  planName?: string;
  planSlug?: string;
  period: "monthly" | "yearly";
  isOld?: boolean;
}): string {
  return "";
}
