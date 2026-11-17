/**
 * Request lists are not available in this fork, so no viewer is ever assigned an
 * upload task: the viewer tus route rejects task uploads.
 */
export function isViewerAssigned(
  _assignments: unknown[],
  _viewer: {
    viewerId?: string | null;
    email?: string | null;
    linkId?: string | null;
    groupIds?: Set<string>;
  },
): boolean {
  return false;
}
