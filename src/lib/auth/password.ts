import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";

const N = 16384;
const R = 8;
const P = 1;
const KEYLEN = 64;
const SALT_BYTES = 16;

function derive(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, KEYLEN, { N, r: R, p: P }, (err, key) =>
      err ? reject(err) : resolve(key),
    );
  });
}

/** Format : `scrypt:<sel hex>:<hash hex>` (sans `$`, sûr dans un fichier .env). */
export async function hashPassword(pw: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const key = await derive(pw, salt);
  return `scrypt:${salt.toString("hex")}:${key.toString("hex")}`;
}

export async function verifyPassword(
  pw: string,
  stored: string,
): Promise<boolean> {
  try {
    const parts = stored.split(":");
    if (parts.length !== 3 || parts[0] !== "scrypt") return false;
    const [, saltHex, hashHex] = parts;
    if (!/^[0-9a-f]+$/i.test(saltHex) || !/^[0-9a-f]+$/i.test(hashHex)) {
      return false;
    }
    const expected = Buffer.from(hashHex, "hex");
    if (expected.length !== KEYLEN) return false;
    const actual = await derive(pw, Buffer.from(saltHex, "hex"));
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}
