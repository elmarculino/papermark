/**
 * [fork] Browser side of passkey login (replaces Hanko's signInWithPasskey):
 * get a one-time challenge, let the device sign it, hand the result to the
 * `passkey` NextAuth provider.
 */
import { get } from "@github/webauthn-json";
import { signIn } from "next-auth/react";

export async function signInWithPasskey({
  callbackUrl,
}: { callbackUrl?: string } = {}) {
  const res = await fetch("/api/passkeys/authenticate", { method: "POST" });
  if (!res.ok) throw new Error("Could not start passkey sign-in");
  const { challengeId, options } = await res.json();
  const credential = await get(options);
  // redirect: false so a refused passkey surfaces as an error (the login
  // page doesn't render ?error=CredentialsSignin).
  const result = await signIn("passkey", {
    challengeId,
    response: JSON.stringify(credential),
    redirect: false,
    ...(callbackUrl ? { callbackUrl } : {}),
  });
  if (!result?.ok || result.error) {
    throw new Error("Passkey not accepted");
  }
  window.location.assign(result.url ?? callbackUrl ?? "/dashboard");
}
