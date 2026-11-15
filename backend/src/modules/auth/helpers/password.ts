import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback) as (
  password: string,
  salt: Buffer,
  keylen: number,
  options: { N: number; r: number; p: number },
) => Promise<Buffer>;

const COST = { N: 16384, r: 8, p: 1 };
const KEY_LENGTH = 32;

// Stored as scrypt$N$salt$hash so the cost can be raised later without breaking old hashes.
export async function hashSecret(secret: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scrypt(secret, salt, KEY_LENGTH, COST);
  return `scrypt$${COST.N}$${salt.toString("base64")}$${hash.toString("base64")}`;
}

export async function verifySecret(
  secret: string,
  stored: string,
): Promise<boolean> {
  const [scheme, n, salt, hash] = stored.split("$");
  if (scheme !== "scrypt" || !n || !salt || !hash) return false;
  const expected = Buffer.from(hash, "base64");
  const actual = await scrypt(secret, Buffer.from(salt, "base64"), expected.length, {
    ...COST,
    N: Number(n),
  });
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

// Burns the same time as a real check so an unknown login id cannot be told apart by speed.
const DUMMY_HASH = "scrypt$16384$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
export async function burnVerifyTime(secret: string): Promise<void> {
  await verifySecret(secret, DUMMY_HASH);
}

export function minimumPasscodeProblem(passcode: string): string | null {
  if (passcode.length < 10) return "Passcode must be at least 10 characters.";
  if (!/[a-zA-Z]/.test(passcode) || !/[0-9]/.test(passcode))
    return "Passcode must contain letters and numbers.";
  return null;
}
