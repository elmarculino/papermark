export type SubscriptionDiscount = {
  valid: boolean;
  couponId: string;
  couponTestId?: string;
  percentOff: number | null;
  amountOff: number | null;
  duration: "forever" | "once" | "repeating";
  durationInMonths: number | null;
  validUntil: number | null;
};
