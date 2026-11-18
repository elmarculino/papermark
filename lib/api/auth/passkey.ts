// [fork] Passkeys run on SimpleWebAuthn in the fork (oss/passkeys), not Hanko.
export {
  finishServerPasskeyRegistration,
  listUserPasskeys,
  removeUserPasskey,
  startServerPasskeyRegistration,
} from "@/ee/passkeys/server";
