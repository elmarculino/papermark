/** No billing when self-hosted: every price has a minimum seat quantity of 1. */
export function getQuantityFromPriceId(_priceId?: string | null): number {
  return 1;
}
