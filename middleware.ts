import { NextResponse, type NextRequest } from "next/server";
import { AUTH_COOKIE, tokenFor, same } from "@/lib/auth";

export async function middleware(req: NextRequest) {
  const password = process.env.SITE_PASSWORD;
  if (!password) {
    // No password set: allowed when running locally, locked when deployed.
    if (process.env.NODE_ENV !== "production") return NextResponse.next();
    return new NextResponse("Site password is not configured.", { status: 503 });
  }
  const cookie = req.cookies.get(AUTH_COOKIE)?.value ?? "";
  if (same(cookie, await tokenFor(password))) return NextResponse.next();
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.search = `?next=${encodeURIComponent(req.nextUrl.pathname + req.nextUrl.search)}`;
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!login|_next/static|_next/image|favicon.ico).*)"],
};
