import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { AUTH_COOKIE, isSignedIn } from "@/lib/auth";
import { exchangeCode, YAHOO_COOKIE } from "@/lib/yahoo";

export async function GET(req: NextRequest) {
  const jar = await cookies();
  if (!(await isSignedIn(jar.get(AUTH_COOKIE)?.value))) return NextResponse.redirect(new URL("/login", req.url));
  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state");
  if (!code || !state || state !== jar.get("fhq_yahoo_state")?.value) {
    return NextResponse.redirect(new URL("/yahoo?error=state", req.url));
  }
  let refresh: string;
  try {
    refresh = await exchangeCode(code, req.nextUrl.origin);
  } catch (e) {
    return NextResponse.redirect(new URL(`/yahoo?error=${encodeURIComponent((e as Error).message)}`, req.url));
  }
  const res = NextResponse.redirect(new URL("/yahoo", req.url));
  res.cookies.delete("fhq_yahoo_state");
  res.cookies.set(YAHOO_COOKIE, refresh, { httpOnly: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 365, secure: true });
  return res;
}
