import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { AUTH_COOKIE, tokenFor, same } from "@/lib/auth";

const SLEEPER_COOKIE = "fhq_sleeper";

// Saves the Sleeper username so the home page can skip straight to your leagues.
export async function GET(req: NextRequest) {
  const jar = await cookies();
  const pw = process.env.SITE_PASSWORD ?? "";
  if (!pw || !same(jar.get(AUTH_COOKIE)?.value ?? "", await tokenFor(pw))) {
    if (pw || process.env.NODE_ENV === "production") return NextResponse.redirect(new URL("/login", req.url));
  }
  const u = req.nextUrl.searchParams.get("u")?.trim();
  if (!u) return NextResponse.redirect(new URL("/?change=1", req.url));
  const res = NextResponse.redirect(new URL(`/sleeper/${encodeURIComponent(u)}`, req.url));
  res.cookies.set(SLEEPER_COOKIE, u, { httpOnly: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 365,
    secure: process.env.NODE_ENV === "production" });
  return res;
}
