/**
 * [fork] Which optional sign-in buttons the login and register pages show.
 * Upstream always shows Google, LinkedIn and passkey; a self-host without
 * those keys got buttons that fail. A provider counts as configured when its
 * keys are set and not a placeholder ("unused", or the "add-your-…" values of
 * .env.example; lib/hanko.ts needs Hanko's keys set, so installs fill in one).
 * Server-only: read at request time, so the runtime env applies. The Hanko
 * tenant is read exactly as lib/hanko.ts reads it (inlined if set at build
 * time, else from the runtime env) and handed to the passkey button, so the
 * button, the browser and the server use the same tenant.
 */
export type LoginMethods = {
  google: boolean;
  linkedin: boolean;
  passkey: boolean;
  hankoTenantId: string | null;
};

function isValue(value: string | undefined): boolean {
  const v = value?.trim();
  return !!v && !/^(unused$|add-your-)/i.test(v);
}

function isSet(name: string): boolean {
  return isValue(process.env[name]);
}

export function getLoginMethods(): LoginMethods {
  const hankoTenantId = process.env.NEXT_PUBLIC_HANKO_TENANT_ID ?? null;
  return {
    google: isSet("GOOGLE_CLIENT_ID") && isSet("GOOGLE_CLIENT_SECRET"),
    linkedin: isSet("LINKEDIN_CLIENT_ID") && isSet("LINKEDIN_CLIENT_SECRET"),
    passkey: isSet("HANKO_API_KEY") && isValue(hankoTenantId ?? undefined),
    hankoTenantId,
  };
}
