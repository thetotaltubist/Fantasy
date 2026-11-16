import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { AUTH_COOKIE, isSignedIn } from "@/lib/auth";
import { exchangeCode, YAHOO_COOKIE, SITE_URL } from "@/lib/yahoo";

export async function GET(req: NextRequest) {
  const jar = await cookies();
  if (!(await isSignedIn(jar.get(AUTH_COOKIE)?.value))) return NextResponse.redirect(new URL("/login", SITE_URL));
  const yahooError = req.nextUrl.searchParams.get("error_description") ?? req.nextUrl.searchParams.get("error");
  if (yahooError) return NextResponse.redirect(new URL(`/yahoo?error=${encodeURIComponent(yahooError)}`, SITE_URL));
  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state");
  if (!code || !state || state !== jar.get("fhq_yahoo_state")?.value) {
    return NextResponse.redirect(new URL("/yahoo?error=state", SITE_URL));
  }
  let refresh: string;
  try {
    refresh = await exchangeCode(code);
  } catch (e) {
    return NextResponse.redirect(new URL(`/yahoo?error=${encodeURIComponent((e as Error).message)}`, SITE_URL));
  }
  const res = NextResponse.redirect(new URL("/yahoo", SITE_URL));
  res.cookies.delete("fhq_yahoo_state");
  res.cookies.set(YAHOO_COOKIE, refresh, { httpOnly: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 365, secure: true });
  return res;
}
