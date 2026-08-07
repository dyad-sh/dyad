import { randomBytes } from "crypto";

/** 48 bytes of CSPRNG entropy, url-safe. Never derived from the invited email. */
export function generateInviteToken(): string {
  return randomBytes(48).toString("base64url");
}
