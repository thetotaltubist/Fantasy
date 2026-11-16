import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { AUTH_COOKIE, isSignedIn } from "@/lib/auth";
import { authorizeUrl, SITE_URL } from "@/lib/yahoo";

export async function GET(_req: NextRequest) {
  const jar = await cookies();
  if (!(await isSignedIn(jar.get(AUTH_COOKIE)?.value))) return NextResponse.redirect(new URL("/login", SITE_URL));
  const state = crypto.randomUUID();
  const res = NextResponse.redirect(authorizeUrl(state));
  res.cookies.set("fhq_yahoo_state", state, { httpOnly: true, sameSite: "lax", path: "/", maxAge: 600, secure: true });
  return res;
}
