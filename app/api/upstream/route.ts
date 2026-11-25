import { NextResponse, type NextRequest } from "next/server";
import { AUTH_COOKIE, isSignedIn } from "@/lib/auth";

// Pass-through for the Mac app: it asks FantasyPros and The Odds API through this site, so the
// API keys stay in the site's settings and never reach the app. Only signed-in callers (the site
// password's token, as a cookie or a Bearer header), only these two services, only GET, and only
// the NFL addresses the advice code uses.
const ALLOWED: { host: string; path: RegExp; key: "FANTASYPROS_API_KEY" | "ODDS_API_KEY" }[] = [
  { host: "api.fantasypros.com", path: /^\/public\/v2\/json\/nfl\/\d{4}\/consensus-rankings$/, key: "FANTASYPROS_API_KEY" },
  { host: "api.the-odds-api.com", path: /^\/v4\/sports\/americanfootball_nfl\/(odds|events|events\/[A-Za-z0-9]+\/odds)$/, key: "ODDS_API_KEY" },
];

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const bearer = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!(await isSignedIn(bearer || req.cookies.get(AUTH_COOKIE)?.value))) {
    await new Promise((r) => setTimeout(r, 1000));   // slow down guessing
    return NextResponse.json({ error: "Sign in with the site password." }, { status: 401 });
  }
  const raw = req.nextUrl.searchParams.get("u");
  if (!raw) {
    // A plain check that the token works, and which keys the site has.
    return NextResponse.json({ ok: true, fantasypros: !!process.env.FANTASYPROS_API_KEY, odds: !!process.env.ODDS_API_KEY });
  }
  let url: URL;
  try { url = new URL(raw); } catch { return NextResponse.json({ error: "Bad address." }, { status: 400 }); }
  const rule = ALLOWED.find((a) => url.protocol === "https:" && url.hostname === a.host && a.path.test(url.pathname));
  if (!rule) return NextResponse.json({ error: "Not an allowed address." }, { status: 403 });
  const key = process.env[rule.key];
  if (!key) return NextResponse.json({ error: `The site has no ${rule.key}.` }, { status: 503 });

  url.searchParams.delete("apiKey");
  const headers: Record<string, string> = { Accept: "application/json" };
  if (rule.key === "ODDS_API_KEY") url.searchParams.set("apiKey", key);
  else headers["x-api-key"] = key;
  try {
    const res = await fetch(url, { headers, cache: "no-store" });
    return new NextResponse(await res.text(), {
      status: res.status, headers: { "Content-Type": res.headers.get("content-type") ?? "application/json", "Cache-Control": "no-store" },
    });
  } catch {
    return NextResponse.json({ error: "Couldn't reach the service." }, { status: 502 });
  }
}
