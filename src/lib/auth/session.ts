import { jwtVerify, SignJWT } from "jose";

export const SESSION_COOKIE = "fa_session";
export const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

const MIN_SECRET_LENGTH = 32;

// Le secret est lu à l'appel (jamais à l'import) pour que le build passe sans variables d'environnement.
// Un secret de moins de 32 caractères est considéré comme absent (échec fermé).
function getKey(): Uint8Array | null {
  const secret = process.env.SESSION_SECRET;
  return secret && secret.length >= MIN_SECRET_LENGTH
    ? new TextEncoder().encode(secret)
    : null;
}

export function isSessionSecretConfigured(): boolean {
  return getKey() !== null;
}

export async function createSession(): Promise<string> {
  const key = getKey();
  if (!key) throw new Error("SESSION_SECRET manquant");
  return new SignJWT({})
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_MAX_AGE_SECONDS}s`)
    .sign(key);
}

export async function verifySession(token: string | undefined): Promise<boolean> {
  const key = getKey();
  if (!token || !key) return false;
  try {
    await jwtVerify(token, key, { algorithms: ["HS256"] });
    return true;
  } catch {
    return false;
  }
}

/** `true`/`false` forcent la valeur ; `auto` (ou absent) suit le protocole de la requête. */
export function shouldUseSecureCookie(
  setting: string | undefined,
  proto: string | null,
): boolean {
  if (setting === "true") return true;
  if (setting === "false") return false;
  return proto === "https";
}

/** Protocole effectif : 1re valeur de `x-forwarded-proto`, sinon celui de l'URL (sans `:`). */
export function requestProto(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-proto");
  if (forwarded) return forwarded.split(",")[0].trim().toLowerCase();
  return new URL(request.url).protocol.replace(/:$/, "").toLowerCase();
}
