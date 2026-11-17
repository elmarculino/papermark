/** Data-room freeze is not available: no archive is ever in progress. */
export function useFreezeProgress(_args: Record<string, unknown>) {
  return { isArchiveInProgress: false, progress: 0, progressText: "" };
}
