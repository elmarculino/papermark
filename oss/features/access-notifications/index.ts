/**
 * Not available in this fork: team notifications about denied link access.
 * The view routes still deny the request; this only skips the notification.
 */
export async function reportDeniedAccessAttempt(
  _link: unknown,
  _email: string,
  _reason?: unknown,
): Promise<void> {}
