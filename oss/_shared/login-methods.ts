/**
 * [fork] Which optional sign-in buttons the login and register pages show.
 * Upstream always shows Google, LinkedIn and passkey; a self-host without
 * those keys got buttons that fail. A provider counts as configured when its
 * keys are set and not a placeholder ("unused", or the "add-your-…" values of
 * .env.example; lib/hanko.ts needs Hanko's keys set, so installs fill in one).
 * Server-only: read at request time, so the runtime env applies.
 */
export type LoginMethods = {
  google: boolean;
  linkedin: boolean;
  passkey: boolean;
};

function isSet(name: string): boolean {
  const value = process.env[name]?.trim();
  return !!value && !/^(unused$|add-your-)/i.test(value);
}

export function getLoginMethods(): LoginMethods {
  return {
    google: isSet("GOOGLE_CLIENT_ID") && isSet("GOOGLE_CLIENT_SECRET"),
    linkedin: isSet("LINKEDIN_CLIENT_ID") && isSet("LINKEDIN_CLIENT_SECRET"),
    passkey: isSet("HANKO_API_KEY") && isSet("NEXT_PUBLIC_HANKO_TENANT_ID"),
  };
}
