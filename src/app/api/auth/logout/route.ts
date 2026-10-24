import { NextResponse } from "next/server";
import {
  requestProto,
  SESSION_COOKIE,
  shouldUseSecureCookie,
} from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export function POST(request: Request) {
  const response = NextResponse.json({ ok: true });
  response.cookies.set(SESSION_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 0,
    secure: shouldUseSecureCookie(process.env.COOKIE_SECURE, requestProto(request)),
  });
  return response;
}
