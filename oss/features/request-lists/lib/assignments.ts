/**
 * Request lists are not available in this fork, so no viewer is assigned an upload
 * task. The viewer tus route only consults this for task uploads on links without
 * uploads enabled; those are refused. Links with uploads enabled behave as upstream.
 * (No AGPL code creates tasks, so a fresh install has none.)
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
