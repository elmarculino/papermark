/**
 * [fork] Passkeys (WebAuthn) without Hanko: SimpleWebAuthn (MIT) on the
 * server, credentials in Postgres (`PasskeyCredential`), one-time challenges
 * in Redis (5 minutes). lib/api/auth/passkey.ts re-exports the account
 * functions; the login side is the `passkey` credentials provider in
 * lib/auth/auth-options.ts plus /api/passkeys/authenticate.
 *
 * The relying party is the app's own host (NEXTAUTH_URL). WebAuthn needs a
 * secure context: https with a certificate the device trusts, or localhost.
 */
import {
  type AuthenticationResponseJSON,
  type AuthenticatorTransport,
  type RegistrationResponseJSON,
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from "@simplewebauthn/server";
import { type Session } from "next-auth";
import { randomBytes } from "node:crypto";

import prisma from "@/lib/prisma";
import { redis } from "@/lib/redis";
import { CustomUser } from "@/lib/types";

const CHALLENGE_TTL_SECONDS = 300;

function relyingParty() {
  const base = process.env.NEXTAUTH_URL || process.env.NEXT_PUBLIC_BASE_URL;
  if (!base) throw new Error("NEXTAUTH_URL must be set for passkeys");
  const url = new URL(base);
  return {
    rpID: url.hostname,
    origin: url.origin,
    rpName: process.env.PASSKEY_RP_NAME || "Papermark",
  };
}

async function sessionUserId(session: Session): Promise<string> {
  if (!session) throw new Error("Not logged in");
  const email = (session.user as CustomUser).email;
  const user = await prisma.user.findUnique({
    where: { email: email as string },
    select: { id: true },
  });
  if (!user) throw new Error("User not found");
  return user.id;
}

/** Reads and deletes a stored challenge, so each one is used at most once. */
async function takeChallenge(key: string): Promise<string | null> {
  return (await redis.getdel<string>(key)) ?? null;
}

export async function startServerPasskeyRegistration({
  session,
}: {
  session: Session;
}) {
  const userId = await sessionUserId(session);
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { name: true, email: true },
  });
  const existing = await prisma.passkeyCredential.findMany({
    where: { userId },
    select: { id: true, transports: true },
  });
  const { rpID, rpName } = relyingParty();
  const options = await generateRegistrationOptions({
    rpName,
    rpID,
    userID: new TextEncoder().encode(userId),
    userName: user?.email || userId,
    userDisplayName: user?.name || user?.email || "",
    attestationType: "none",
    excludeCredentials: existing.map((c) => ({
      id: c.id,
      transports: c.transports as AuthenticatorTransport[],
    })),
    // Discoverable credentials: login needs no username first.
    authenticatorSelection: {
      residentKey: "required",
      userVerification: "preferred",
    },
  });
  await redis.set(`passkey:reg:${userId}`, options.challenge, {
    ex: CHALLENGE_TTL_SECONDS,
  });
  // The account page passes this to @github/webauthn-json create().
  return { publicKey: options };
}

export async function finishServerPasskeyRegistration({
  credential,
  session,
}: {
  credential: RegistrationResponseJSON;
  session: Session;
}) {
  const userId = await sessionUserId(session);
  const expectedChallenge = await takeChallenge(`passkey:reg:${userId}`);
  if (!expectedChallenge) throw new Error("Passkey registration expired");
  const { rpID, origin } = relyingParty();
  const { verified, registrationInfo } = await verifyRegistrationResponse({
    response: credential,
    expectedChallenge,
    expectedOrigin: origin,
    expectedRPID: rpID,
    requireUserVerification: false,
  });
  if (!verified || !registrationInfo) {
    throw new Error("Passkey registration could not be verified");
  }
  const {
    credential: c,
    credentialDeviceType,
    credentialBackedUp,
  } = registrationInfo;
  await prisma.passkeyCredential.create({
    data: {
      id: c.id,
      userId,
      publicKey: Buffer.from(c.publicKey),
      counter: BigInt(c.counter),
      transports: c.transports ?? [],
      deviceType: credentialDeviceType,
      backedUp: credentialBackedUp,
    },
  });
}

/** Same shape the account page got from Hanko's credentials API. */
export async function listUserPasskeys({ session }: { session: Session }) {
  const userId = await sessionUserId(session);
  const rows = await prisma.passkeyCredential.findMany({
    where: { userId },
    orderBy: { createdAt: "asc" },
  });
  return rows.map((c) => ({
    id: c.id,
    name: c.name ?? "",
    created_at: c.createdAt.toISOString(),
    last_used_at: c.lastUsedAt?.toISOString() ?? null,
    transports: c.transports,
    backup_eligible: c.deviceType === "multiDevice",
    backup_state: c.backedUp,
    is_mfa: false,
  }));
}

export async function removeUserPasskey({
  credentialId,
  session,
}: {
  credentialId: string;
  session: Session;
}) {
  const userId = await sessionUserId(session);
  const { count } = await prisma.passkeyCredential.deleteMany({
    where: { id: credentialId, userId },
  });
  if (count === 0) throw new Error("Unauthorized");
}

/** Login, step 1: a one-time challenge for any of this site's passkeys. */
export async function startPasskeyLogin() {
  const { rpID } = relyingParty();
  const options = await generateAuthenticationOptions({
    rpID,
    userVerification: "preferred",
  });
  const challengeId = randomBytes(18).toString("base64url");
  await redis.set(`passkey:auth:${challengeId}`, options.challenge, {
    ex: CHALLENGE_TTL_SECONDS,
  });
  return { challengeId, options: { publicKey: options } };
}

/** Login, step 2: the user id the signed challenge proves, or null. */
export async function verifyPasskeyLogin({
  challengeId,
  response,
}: {
  challengeId: string;
  response: AuthenticationResponseJSON;
}): Promise<string | null> {
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(challengeId)) return null;
  const expectedChallenge = await takeChallenge(`passkey:auth:${challengeId}`);
  if (!expectedChallenge) return null;
  const stored = await prisma.passkeyCredential.findUnique({
    where: { id: response.id },
  });
  if (!stored) return null;
  const { rpID, origin } = relyingParty();
  const { verified, authenticationInfo } = await verifyAuthenticationResponse({
    response,
    expectedChallenge,
    expectedOrigin: origin,
    expectedRPID: rpID,
    requireUserVerification: false,
    credential: {
      id: stored.id,
      publicKey: new Uint8Array(stored.publicKey),
      counter: Number(stored.counter),
      transports: stored.transports as AuthenticatorTransport[],
    },
  });
  if (!verified) return null;
  await prisma.passkeyCredential.update({
    where: { id: stored.id },
    data: {
      counter: BigInt(authenticationInfo.newCounter),
      lastUsedAt: new Date(),
    },
  });
  return stored.userId;
}
