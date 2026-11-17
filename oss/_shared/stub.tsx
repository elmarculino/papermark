import type { NextApiRequest, NextApiResponse } from "next";

import type { ReactNode } from "react";

/**
 * Helpers for features dropped from this fork. Call sites stay as upstream wrote
 * them; these accept any props so they never need to track upstream prop changes.
 */
type AnyProps = { children?: ReactNode } & Record<string, unknown>;

/** Renders nothing. For buttons, dialogs, panels and settings cards of dropped features. */
export function NullComponent(_props: AnyProps): null {
  return null;
}

/** Renders its children unchanged. For providers and layout wrappers of dropped features. */
export function PassThrough({ children }: AnyProps) {
  return <>{children}</>;
}

/** Full page for a dropped feature. */
export function FeatureUnavailablePage(_props: AnyProps) {
  return (
    <div className="flex min-h-[50vh] items-center justify-center p-8 text-sm text-muted-foreground">
      This feature is not available in this edition.
    </div>
  );
}

/** API route for a dropped feature. */
export async function notAvailableRoute(
  _req: NextApiRequest,
  res: NextApiResponse,
) {
  return res
    .status(404)
    .json({ error: "This feature is not available in this edition." });
}
