/**
 * [fork] Which optional sign-in buttons the login and register pages show.
 * Upstream always shows Google and LinkedIn; a self-host without those keys
 * got buttons that fail. A provider counts as configured when its keys are
 * set and not a placeholder ("unused", or the "add-your-…" values of
 * .env.example). Passkeys need no external service (oss/passkeys) and are on
 * unless PASSKEY_LOGIN=false.
 * Server-only: read at request time, so the runtime env applies.
 */
export type LoginMethods = {
  google: boolean;
  linkedin: boolean;
  passkey: boolean;
};

function isSet(name: string): boolean {
  const v = process.env[name]?.trim();
  return !!v && !/^(unused$|add-your-)/i.test(v);
}

export function getLoginMethods(): LoginMethods {
  return {
    google: isSet("GOOGLE_CLIENT_ID") && isSet("GOOGLE_CLIENT_SECRET"),
    linkedin: isSet("LINKEDIN_CLIENT_ID") && isSet("LINKEDIN_CLIENT_SECRET"),
    passkey: process.env.PASSKEY_LOGIN !== "false",
  };
}
