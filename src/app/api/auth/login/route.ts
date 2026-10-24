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

const bodySchema = z.object({ password: z.string().min(1) });

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
      body = await request.json();
    } catch {
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
