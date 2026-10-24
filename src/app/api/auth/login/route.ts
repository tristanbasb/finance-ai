import { NextResponse } from "next/server";
import { z } from "zod";
import { verifyPassword } from "@/lib/auth/password";
import { createRateLimiter } from "@/lib/auth/rate-limit";
import {
  createSession,
  requestProto,
  SESSION_COOKIE,
  SESSION_MAX_AGE_SECONDS,
  shouldUseSecureCookie,
} from "@/lib/auth/session";

export const dynamic = "force-dynamic";

const bodySchema = z.object({ password: z.string().min(1) });

// 5 tentatives par tranche de 15 minutes et par IP (en mémoire : suffisant pour une instance unique).
const limiter = createRateLimiter(5, 15 * 60 * 1000);

export async function POST(request: Request) {
  const hash = process.env.APP_PASSWORD_HASH;
  if (!process.env.SESSION_SECRET || !hash) {
    return Response.json(
      { error: "Configuration manquante : lancez install.sh" },
      { status: 500 },
    );
  }

  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0].trim() || "local";
  if (!limiter.hit(ip)) {
    return Response.json(
      { error: "Trop de tentatives, réessayez dans quelques minutes." },
      { status: 429 },
    );
  }

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
    return Response.json({ error: "Mot de passe incorrect" }, { status: 401 });
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.set(SESSION_COOKIE, await createSession(), {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
    secure: shouldUseSecureCookie(process.env.COOKIE_SECURE, requestProto(request)),
  });
  return response;
}
