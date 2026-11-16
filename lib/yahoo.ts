// Yahoo Fantasy Sports API (OAuth 2). Read-only.
import { cookies } from "next/headers";

const AUTH = "https://api.login.yahoo.com/oauth2";
const API = "https://fantasysports.yahooapis.com/fantasy/v2";
export const YAHOO_COOKIE = "fhq_yahoo";

// The Yahoo refresh token lives in a private (httpOnly) cookie on your browser.
async function refreshToken() {
  return (await cookies()).get(YAHOO_COOKIE)?.value ?? null;
}

// The public address of the site. Yahoo only accepts the exact redirect
// address registered in the Yahoo app, so never derive it from the request.
export const SITE_URL = (process.env.SITE_URL ?? "https://fantasy-hq-tubist.netlify.app").replace(/\/$/, "");
export const redirectUri = () => `${SITE_URL}/api/yahoo/callback`;

export function authorizeUrl(state: string) {
  const q = new URLSearchParams({
    client_id: process.env.YAHOO_CLIENT_ID ?? "", redirect_uri: redirectUri(),
    response_type: "code", state,
  });
  return `${AUTH}/request_auth?${q}`;
}

async function tokenRequest(body: Record<string, string>) {
  const basic = Buffer.from(`${process.env.YAHOO_CLIENT_ID}:${process.env.YAHOO_CLIENT_SECRET}`).toString("base64");
  const res = await fetch(`${AUTH}/get_token`, {
    method: "POST", cache: "no-store",
    headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`Yahoo sign-in failed: ${json.error_description ?? json.error ?? res.status}`);
  return json as { access_token: string; refresh_token: string; expires_in: number };
}

// Returns the refresh token to store in the cookie.
export async function exchangeCode(code: string): Promise<string> {
  const t = await tokenRequest({ grant_type: "authorization_code", code, redirect_uri: redirectUri() });
  cache.set(t.refresh_token, { token: t.access_token, until: Date.now() + (t.expires_in - 120) * 1000 });
  return t.refresh_token;
}

export const isConnected = async () => !!(await refreshToken());

// Access tokens last an hour; keep them in memory keyed by refresh token.
const cache = new Map<string, { token: string; until: number }>();
async function accessToken(): Promise<string | null> {
  const refresh = await refreshToken();
  if (!refresh) return null;
  const hit = cache.get(refresh);
  if (hit && Date.now() < hit.until) return hit.token;
  const t = await tokenRequest({ grant_type: "refresh_token", refresh_token: refresh, redirect_uri: "oob" });
  cache.set(refresh, { token: t.access_token, until: Date.now() + (t.expires_in - 120) * 1000 });
  return t.access_token;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type J = any;

async function get(path: string): Promise<J> {
  const token = await accessToken();
  if (!token) throw new Error("Yahoo is not connected.");
  const res = await fetch(`${API}${path}${path.includes("?") ? "&" : "?"}format=json`, {
    headers: { Authorization: `Bearer ${token}` }, next: { revalidate: 300 },
  });
  if (!res.ok) throw new Error(`Yahoo ${path} failed: ${res.status}`);
  return (await res.json()).fantasy_content;
}

// Yahoo JSON quirks: lists are objects keyed "0","1",... plus "count";
// records are arrays of one-key objects that need merging.
function list(obj: J, key: string): J[] {
  if (!obj) return [];
  return Object.keys(obj).filter((k) => /^\d+$/.test(k)).map((k) => obj[k]?.[key]).filter(Boolean);
}
function merge(arr: J): J {
  if (!Array.isArray(arr)) return arr ?? {};
  const out: J = {};
  for (const item of arr) {
    if (Array.isArray(item)) Object.assign(out, merge(item));
    else if (item && typeof item === "object") Object.assign(out, item);
  }
  return out;
}

export type YahooTeam = {
  teamKey: string; leagueKey: string; leagueName: string; teamName: string; numTeams: number;
  wins: number; losses: number; ties: number; rank: number | null; pointsFor: number;
  scoring: string; url?: string;
};

export async function getMyTeams(): Promise<YahooTeam[]> {
  const [leaguesFc, teamsFc] = await Promise.all([
    get("/users;use_login=1/games;game_keys=nfl/leagues"),
    get("/users;use_login=1/games;game_keys=nfl/teams;out=standings"),
  ]);
  const leagueGame = list(list(leaguesFc.users, "user")[0]?.[1]?.games, "game")[0];
  const leagues = list(leagueGame?.[1]?.leagues, "league").map((l: J) => merge(l));
  const byKey = new Map(leagues.map((l: J) => [l.league_key, l]));

  const teamGame = list(list(teamsFc.users, "user")[0]?.[1]?.games, "game")[0];
  return list(teamGame?.[1]?.teams, "team").map((t: J) => {
    const meta = merge(t[0]);
    const st = merge(t.slice(1)).team_standings ?? {};
    const leagueKey = String(meta.team_key).replace(/\.t\.\d+$/, "");
    const lg: J = byKey.get(leagueKey) ?? {};
    const o = st.outcome_totals ?? {};
    return {
      teamKey: meta.team_key, leagueKey, leagueName: lg.name ?? leagueKey,
      teamName: meta.name ?? "My team", numTeams: Number(lg.num_teams ?? 0),
      wins: Number(o.wins ?? 0), losses: Number(o.losses ?? 0), ties: Number(o.ties ?? 0),
      rank: st.rank ? Number(st.rank) : null, pointsFor: Number(st.points_for ?? 0),
      scoring: lg.scoring_type === "head" ? "H2H" : lg.scoring_type ?? "", url: meta.url,
    };
  });
}

export type YahooPlayer = {
  key: string; name: string; pos: string; team: string; slot: string; status: string | null;
};

export async function getRoster(teamKey: string): Promise<{ teamName: string; players: YahooPlayer[] }> {
  const fc = await get(`/team/${teamKey}/roster`);
  const meta = merge(fc.team?.[0]);
  const roster = merge(fc.team?.slice(1)).roster;
  const players = list(roster?.["0"]?.players ?? roster?.players, "player").map((p: J) => {
    const m = merge(p[0]);
    const extra = merge(p.slice(1));
    const slot = merge(extra.selected_position).position ?? "";
    return {
      key: m.player_key, name: m.name?.full ?? "Unknown", pos: m.display_position ?? m.primary_position ?? "",
      team: (m.editorial_team_abbr ?? "").toUpperCase(), slot, status: m.status ?? null,
    };
  });
  return { teamName: meta.name ?? "My team", players };
}
