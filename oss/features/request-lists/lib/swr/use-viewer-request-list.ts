/** Request lists are not available in this fork. */
export function useViewerRequestList(_args: Record<string, unknown>) {
  return {
    enabled: false,
    requestList: null,
    loading: false,
    mutate: async () => undefined,
  };
}
