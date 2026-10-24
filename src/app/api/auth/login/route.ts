import { NextResponse } from "next/server";
import { z } from "zod";
import { verifyPassword } from "@/lib/auth/password";
import {
  clientKey,
  createRateLimiter,
  GLOBAL_KEY,
} from "@/lib/auth/rate-limit";
import {
  createSession,
  isSessionSecretConfigured,
  requestProto,
  SESSION_COOKIE,
  SESSION_MAX_AGE_SECONDS,
  shouldUseSecureCookie,
} from "@/lib/auth/session";

export const dynamic = "force-dynamic";

const bodySchema = z.object({ password: z.string().min(1).max(1024) });

/** Taille maximale du corps de la requête de connexion. */
const MAX_BODY_BYTES = 10 * 1024;
const TOO_LARGE = { error: "Requête trop volumineuse" };

class BodyTooLargeError extends Error {}

/** Lit le corps en texte, en s'arrêtant dès que `max` octets sont dépassés. */
async function readLimitedText(request: Request, max: number): Promise<string> {
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel().catch(() => {});
      throw new BodyTooLargeError();
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

// Échecs seulement : 5 par 15 min et par client, 20 par 15 min au total (en mémoire, instance unique).
const WINDOW_MS = 15 * 60 * 1000;
const clientLimiter = createRateLimiter(5, WINDOW_MS);
const globalLimiter = createRateLimiter(20, WINDOW_MS);

export async function POST(request: Request) {
  const hash = process.env.APP_PASSWORD_HASH;
  if (!isSessionSecretConfigured() || !hash) {
    return Response.json(
      { error: "Configuration manquante : lancez install.sh" },
      { status: 500 },
    );
  }

  // Vérification synchrone, avant la réservation : un corps annoncé trop gros n'est jamais lu.
  if (Number(request.headers.get("content-length")) > MAX_BODY_BYTES) {
    return Response.json(TOO_LARGE, { status: 413 });
  }

  const key = clientKey(
    request.headers.get("x-forwarded-for"),
    process.env.TRUST_PROXY === "true",
  );
  // Réservation synchrone (avant tout await) : une rafale concurrente ne peut pas dépasser les plafonds.
  const clientReservation = clientLimiter.reserve(key);
  const globalReservation = clientReservation && globalLimiter.reserve(GLOBAL_KEY);
  if (!clientReservation || !globalReservation) {
    clientReservation?.release();
    return Response.json(
      { error: "Trop de tentatives, réessayez dans quelques minutes." },
      { status: 429 },
    );
  }

  // La réservation reste comptée uniquement si le mot de passe est faux.
  let failed = false;
  try {
    let body: unknown;
    try {
      body = JSON.parse(await readLimitedText(request, MAX_BODY_BYTES));
    } catch (err) {
      if (err instanceof BodyTooLargeError) return Response.json(TOO_LARGE, { status: 413 });
      return Response.json({ error: "Requête invalide" }, { status: 400 });
    }
    const parsed = bodySchema.safeParse(body);
    if (!parsed.success) {
      return Response.json({ error: "Requête invalide" }, { status: 400 });
    }

    if (!(await verifyPassword(parsed.data.password, hash))) {
      failed = true;
      return Response.json({ error: "Mot de passe incorrect" }, { status: 401 });
    }

    const response = NextResponse.json({ ok: true });
    response.cookies.set(SESSION_COOKIE, await createSession(), {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: SESSION_MAX_AGE_SECONDS,
      secure: shouldUseSecureCookie(
        process.env.COOKIE_SECURE,
        requestProto(request),
      ),
    });
    return response;
  } finally {
    if (!failed) {
      clientReservation.release();
      globalReservation.release();
    }
  }
}
