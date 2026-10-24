import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { isCrossSiteRequest } from "@/lib/auth/csrf";
import { isPublicPath } from "@/lib/auth/public-paths";
import { SESSION_COOKIE, verifySession } from "@/lib/auth/session";

export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  // CSRF : avant tout, y compris pour /api/auth/login (route publique).
  if (
    isCrossSiteRequest({
      method: request.method,
      pathname,
      host: request.headers.get("host"),
      origin: request.headers.get("origin"),
      secFetchSite: request.headers.get("sec-fetch-site"),
      forwardedHost: request.headers.get("x-forwarded-host"),
    })
  ) {
    return NextResponse.json({ error: "Requête refusée" }, { status: 403 });
  }

  if (isPublicPath(pathname)) return NextResponse.next();

  if (await verifySession(request.cookies.get(SESSION_COOKIE)?.value)) {
    return NextResponse.next();
  }

  if (pathname === "/api" || pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
  }

  const loginUrl = request.nextUrl.clone();
  loginUrl.pathname = "/login";
  loginUrl.search = "";
  if (pathname !== "/") loginUrl.searchParams.set("next", pathname + search);
  return NextResponse.redirect(loginUrl);
}

// Le proxy s'exécute sur tous les chemins ; `isPublicPath` décide (liste blanche explicite).
export const config = {
  matcher: ["/:path*"],
};
