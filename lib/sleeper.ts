// Sleeper's public, read-only API. No login or key required.
const BASE = "https://api.sleeper.app/v1";

export type SleeperUser = { user_id: string; username: string; display_name: string; avatar: string | null };
export type NflState = { season: string; week: number; season_type: string };
export type League = {
  league_id: string; name: string; season: string; total_rosters: number; status: string;
  avatar: string | null; roster_positions: string[]; scoring_settings: Record<string, number>;
};
export type Roster = {
  roster_id: number; owner_id: string | null; players: string[] | null; starters: string[] | null;
  reserve: string[] | null; taxi?: string[] | null; co_owners?: string[] | null;
  settings: { wins: number; losses: number; ties: number; fpts?: number; fpts_decimal?: number };
};
export type LeagueUser = { user_id: string; display_name: string; metadata?: { team_name?: string } };
export type Player = {
  player_id: string; full_name?: string; first_name?: string; last_name?: string;
  position: string | null; team: string | null; injury_status: string | null;
};

async function get<T>(path: string, revalidate = 300): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { next: { revalidate } });
  if (!res.ok) throw new Error(`Sleeper ${path} failed: ${res.status}`);
  return res.json() as Promise<T>;
}

export const getUser = (username: string) =>
  get<SleeperUser | null>(`/user/${encodeURIComponent(username)}`);
export const getNflState = () => get<NflState>("/state/nfl", 3600);
export const getLeagues = (userId: string, season: string) =>
  get<League[]>(`/user/${userId}/leagues/nfl/${season}`);
export const getLeague = (id: string) => get<League>(`/league/${id}`);
export const getRosters = (id: string) => get<Roster[]>(`/league/${id}/rosters`);
export const getLeagueUsers = (id: string) => get<LeagueUser[]>(`/league/${id}/users`);

// The full player list is ~5 MB, too big for Next's fetch cache, so keep it in memory for 12 hours.
let playerCache: { at: number; data: Record<string, Player> } | null = null;
export async function getPlayers(): Promise<Record<string, Player>> {
  if (playerCache && Date.now() - playerCache.at < 12 * 3600_000) return playerCache.data;
  const res = await fetch(`${BASE}/players/nfl`, { cache: "no-store" });
  if (!res.ok) throw new Error(`Sleeper players failed: ${res.status}`);
  playerCache = { at: Date.now(), data: await res.json() };
  return playerCache.data;
}

export function playerName(p: Player | undefined, id: string) {
  if (!p) return /^[A-Z]{2,3}$/.test(id) ? `${id} Defense` : `Player ${id}`;
  return p.full_name ?? `${p.first_name ?? ""} ${p.last_name ?? ""}`.trim();
}

// Finds the roster a user owns or co-owns in a league.
export const rosterOf = (rosters: Roster[], userId: string) =>
  rosters.find((r) => r.owner_id === userId || (r.co_owners ?? []).includes(userId));

export const record = (r: Roster) =>
  `${r.settings.wins}-${r.settings.losses}${r.settings.ties ? `-${r.settings.ties}` : ""}`;

const SLOT_LABEL: Record<string, string> = {
  SUPER_FLEX: "SFLX", REC_FLEX: "W/T", WRRB_FLEX: "W/R", IDP_FLEX: "IDP", DEF: "DEF",
};
export const slotLabel = (s?: string) => (s ? SLOT_LABEL[s] ?? s : "");

export const avatarUrl = (id: string | null) => (id ? `https://sleepercdn.com/avatars/thumbs/${id}` : null);

// ---------- Summaries used by the compact pages ----------

export type LeagueSettings = {
  type?: number; best_ball?: number; league_average_match?: number; playoff_week_start?: number;
};
export type LeagueFull = League & { settings?: LeagueSettings };

const BAD_STATUS = new Set(["Out", "IR", "Doubtful", "Sus", "PUP", "NA"]);
export const isAlert = (p?: Player) => !!p?.injury_status && p.injury_status !== "Questionable";
export const isConcern = (p?: Player) => !!p?.injury_status;
export const isBad = (p?: Player) => !!p?.injury_status && BAD_STATUS.has(p.injury_status);

export function formatTags(l: LeagueFull): string[] {
  const s = l.settings ?? {};
  const tags: string[] = [];
  tags.push(s.type === 2 ? "Dynasty" : s.type === 1 ? "Keeper" : "Redraft");
  const rec = l.scoring_settings?.rec ?? 0;
  tags.push(rec >= 1 ? "PPR" : rec >= 0.5 ? "Half PPR" : "Std");
  if (l.roster_positions.includes("SUPER_FLEX")) tags.push("SF");
  if (s.best_ball) tags.push("Best ball");
  if (s.league_average_match) tags.push("Median");
  return tags;
}

export const points = (r: Roster) => (r.settings.fpts ?? 0) + (r.settings.fpts_decimal ?? 0) / 100;

// Standing by wins, then points scored (Sleeper's default tiebreak).
export function rankOf(rosters: Roster[], mine: Roster): number {
  const sorted = [...rosters].sort(
    (a, b) => b.settings.wins - a.settings.wins || points(b) - points(a),
  );
  return sorted.findIndex((r) => r.roster_id === mine.roster_id) + 1;
}

export const ordinal = (n: number) => {
  const s = ["th", "st", "nd", "rd"], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
};
