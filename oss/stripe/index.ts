/** No billing when self-hosted: nothing to cancel. */
export async function cancelSubscription(
  _customerId?: string | null,
  _isOldAccount?: boolean,
): Promise<void> {}
