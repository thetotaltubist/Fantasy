// ESPN leagues, read with the two login cookies from the user's ESPN session and
// converted into the same shapes the Sleeper pages use, so every feature works on both.
import type { LeagueFull, LeagueUser, Player, Roster } from "@/lib/sleeper";
import { norm } from "@/lib/experts";

export const ESPN_COOKIE = "fhq_espn";
export type EspnCreds = { s2: string; swid: string; ids: string[] };

export function parseCreds(raw: string | undefined): EspnCreds | null {
  if (!raw) return null;
  try {
    const c = JSON.parse(raw) as EspnCreds;
    return c && Array.isArray(c.ids) && (c.ids.length || c.s2) ? { s2: c.s2 ?? "", swid: c.swid ?? "", ids: c.ids } : null;
  } catch { return null; }
}

// The espn_s2 code can be written two ways (with %2B-style escapes, as the browser shows it,
// or plain). Try it as pasted first, then the other spellings, until ESPN accepts one.
async function espnFetch(url: string, s2: string, swid: string): Promise<Response> {
  const forms = [s2];
  try { const d = decodeURIComponent(s2); if (!forms.includes(d)) forms.push(d); } catch { /* not escaped */ }
  const e = encodeURIComponent(forms[forms.length - 1]); if (!forms.includes(e)) forms.push(e);
  let last: Response | null = null;
  for (const f of s2 ? forms : [""]) {
    last = await fetch(url, {
      headers: f ? { Cookie: `espn_s2=${f}; SWID=${swid}`, Accept: "application/json", "X-Fantasy-Source": "kona", "X-Fantasy-Platform": "kona-PROD" } : { Accept: "application/json" },
      cache: "no-store",
    });
    if (last.status !== 401 && last.status !== 403) return last;
  }
  return last as Response;
}

// Ask ESPN which fantasy football leagues this login belongs to, for the given season.
export type Discovery = { ids: string[]; note: string };
export async function discoverLeagues(s2: string, swid: string, season: string): Promise<Discovery> {
  if (!s2 || !swid) return { ids: [], note: "Both codes are needed to look up your leagues." };
  try {
    const res = await espnFetch(
      `https://fan.espn.com/apis/v2/fans/${encodeURIComponent(swid)}?displayHiddenPrefs=true&context=fantasy&useCookieAuth=true&source=fantasyapp-ios&featureFlags=challengeEntries`,
      s2, swid,
    );
    if (!res.ok) return { ids: [], note: `ESPN's account lookup answered ${res.status}.` };
    const d = (await res.json()) as { preferences?: { metaData?: { entry?: { gameId?: number; abbrev?: string; seasonId?: number; groups?: { groupId?: number }[] } } }[] };
    const ids = new Set<string>();
    let entries = 0;
    for (const p of d.preferences ?? []) {
      const e = p.metaData?.entry;
      if (!e) continue;
      entries += 1;
      if (!(e.gameId === 1 || e.abbrev === "FFL") || String(e.seasonId) !== season) continue;
      for (const g of e.groups ?? []) if (g.groupId) ids.add(String(g.groupId));
    }
    return { ids: [...ids], note: `ESPN's account lookup worked: ${(d.preferences ?? []).length} items, ${entries} fantasy entries, ${ids.size} football leagues for ${season}.` };
  } catch (err) { return { ids: [], note: `Couldn't reach ESPN's account lookup (${String((err as Error)?.message ?? err).slice(0, 80)}).` }; }
}

const SLOT: Record<number, string> = {
  0: "QB", 2: "RB", 3: "WRRB_FLEX", 4: "WR", 5: "REC_FLEX", 6: "TE", 7: "SUPER_FLEX", 16: "DEF", 17: "K", 23: "FLEX",
};
const SLOT_ORDER = [0, 2, 4, 6, 23, 3, 5, 7, 16, 17];
const BENCH = 20, IR = 21;
const POSITION: Record<number, string> = { 1: "QB", 2: "RB", 3: "WR", 4: "TE", 5: "K", 16: "DEF" };
const TEAM: Record<number, string> = {
  1: "ATL", 2: "BUF", 3: "CHI", 4: "CIN", 5: "CLE", 6: "DAL", 7: "DEN", 8: "DET", 9: "GB", 10: "TEN", 11: "IND",
  12: "KC", 13: "LV", 14: "LAR", 15: "MIA", 16: "MIN", 17: "NE", 18: "NO", 19: "NYG", 20: "NYJ", 21: "PHI",
  22: "ARI", 23: "PIT", 24: "LAC", 25: "SF", 26: "SEA", 27: "TB", 28: "WAS", 29: "CAR", 30: "JAX", 33: "BAL", 34: "HOU",
};
// ESPN scoring ids -> the stat names Sleeper's projections use.
const STAT: Record<number, string[]> = {
  3: ["pass_yd"], 4: ["pass_td"], 19: ["pass_2pt"], 20: ["pass_int"],
  24: ["rush_yd"], 25: ["rush_td"], 26: ["rush_2pt"],
  42: ["rec_yd"], 43: ["rec_td"], 44: ["rec_2pt"], 53: ["rec"], 72: ["fum_lost"],
  74: ["fgm_50p"], 77: ["fgm_40_49"], 80: ["fgm_0_19", "fgm_20_29", "fgm_30_39"], 85: ["fgmiss"], 86: ["xpm"], 88: ["xpmiss"],
  95: ["int"], 96: ["fum_rec"], 98: ["safe"], 99: ["sack"], 93: ["blk_kick"],
  101: ["def_st_td"], 102: ["def_st_td"], 103: ["def_td"], 104: ["def_td"],
  89: ["pts_allow_0"], 90: ["pts_allow_1_6"], 91: ["pts_allow_7_13"], 92: ["pts_allow_14_20"],
  122: ["pts_allow_21_27"], 123: ["pts_allow_28_34"], 124: ["pts_allow_35p"],
};

type EspnPlayer = { id: number; fullName?: string; defaultPositionId?: number; proTeamId?: number; injuryStatus?: string };
type EspnEntry = { playerId: number; lineupSlotId: number; playerPoolEntry?: { player?: EspnPlayer } };
type EspnTeam = {
  id: number; name?: string; location?: string; nickname?: string; abbrev?: string; owners?: string[]; primaryOwner?: string;
  record?: { overall?: { wins?: number; losses?: number; ties?: number; pointsFor?: number } };
  roster?: { entries?: EspnEntry[] };
};
type EspnLeague = {
  id: number; members?: { id: string; displayName?: string }[]; teams?: EspnTeam[];
  settings?: {
    name?: string;
    rosterSettings?: { lineupSlotCounts?: Record<string, number> };
    scoringSettings?: { scoringItems?: { statId: number; points: number }[] };
    scheduleSettings?: { matchupPeriodCount?: number };
  };
};

export type EspnResult =
  | { ok: true; league: LeagueFull; rosters: Roster[]; users: LeagueUser[]; players: Record<string, Player>; mine: Roster | null; team?: string }
  | { ok: false; id: string; error: string };

const INJURY: Record<string, string> = { OUT: "Out", INJURY_RESERVE: "IR", DOUBTFUL: "Doubtful", QUESTIONABLE: "Questionable", SUSPENSION: "Sus" };
const clean = (s: string) => s.replace(/[{}]/g, "").toUpperCase();

// Name + position -> Sleeper player id, built once per players list.
let index: { src: object; map: Map<string, string[]> } | null = null;
function lookup(players: Record<string, Player>) {
  if (index?.src === players) return index.map;
  const map = new Map<string, string[]>();
  for (const [id, p] of Object.entries(players)) {
    const name = p.full_name ?? `${p.first_name ?? ""} ${p.last_name ?? ""}`.trim();
    if (!name || !p.position) continue;
    const k = `${norm(name)}|${p.position}`;
    const list = map.get(k); if (list) list.push(id); else map.set(k, [id]);
  }
  index = { src: players, map };
  return map;
}

export async function getEspnLeague(id: string, season: string, creds: EspnCreds, sleeperPlayers: Record<string, Player>): Promise<EspnResult> {
  let data: EspnLeague;
  try {
    const res = await espnFetch(
      `https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/${season}/segments/0/leagues/${encodeURIComponent(id)}?view=mSettings&view=mRoster&view=mTeam`,
      creds.s2, creds.swid,
    );
    if (res.status === 401 || res.status === 403) return { ok: false, id, error: `ESPN refused the login codes for this league (answer ${res.status}). They may be incomplete or expired.` };
    if (res.status === 404) return { ok: false, id, error: "ESPN has no league with this ID for this season." };
    if (!res.ok) return { ok: false, id, error: `ESPN returned an error (${res.status}).` };
    data = (await res.json()) as EspnLeague;
  } catch (err) { return { ok: false, id, error: `Couldn't read ESPN's answer (${String((err as Error)?.message ?? err).slice(0, 80)}).` }; }

  const players: Record<string, Player> = { ...sleeperPlayers };
  const map = lookup(sleeperPlayers);
  const toSleeper = (e: EspnEntry): string => {
    const p = e.playerPoolEntry?.player;
    const pos = POSITION[p?.defaultPositionId ?? -1], team = TEAM[p?.proTeamId ?? -1] ?? null;
    if (pos === "DEF" && team) return team;
    const hits = p?.fullName && pos ? map.get(`${norm(p.fullName)}|${pos}`) ?? [] : [];
    const hit = hits.find((h) => sleeperPlayers[h].team === team) ?? hits.find((h) => sleeperPlayers[h].team) ?? hits[0];
    if (hit) return hit;
    // Not in Sleeper's list: keep him visible under an ESPN id, just without projections.
    const pid = `espn${e.playerId}`;
    players[pid] = { player_id: pid, full_name: p?.fullName ?? `Player ${e.playerId}`, position: pos ?? null, team, injury_status: INJURY[p?.injuryStatus ?? ""] ?? null };
    return pid;
  };

  const counts = data.settings?.rosterSettings?.lineupSlotCounts ?? {};
  const startSlots = SLOT_ORDER.flatMap((s) => Array.from({ length: counts[s] ?? 0 }, () => s));
  const roster_positions = [
    ...startSlots.map((s) => SLOT[s]),
    ...Array.from({ length: counts[BENCH] ?? 0 }, () => "BN"),
    ...Array.from({ length: counts[IR] ?? 0 }, () => "IR"),
  ];
  const scoring_settings: Record<string, number> = {};
  for (const it of data.settings?.scoringSettings?.scoringItems ?? []) for (const k of STAT[it.statId] ?? []) scoring_settings[k] = it.points;

  const memberName = new Map((data.members ?? []).map((m) => [m.id, m.displayName ?? ""]));
  const users: LeagueUser[] = [], rosters: Roster[] = [];
  const me = clean(creds.swid);
  let mine: Roster | null = null, myTeam: string | undefined;
  for (const t of data.teams ?? []) {
    const entries = t.roster?.entries ?? [];
    const pool = entries.map((e) => ({ slot: e.lineupSlotId, id: toSleeper(e) }));
    const left = [...pool];
    const starters = startSlots.map((s) => { const i = left.findIndex((x) => x.slot === s); return i >= 0 ? left.splice(i, 1)[0].id : "0"; });
    const owner = t.primaryOwner ?? t.owners?.[0] ?? `team${t.id}`;
    const name = (t.name ?? `${t.location ?? ""} ${t.nickname ?? ""}`).trim() || t.abbrev || `Team ${t.id}`;
    const pf = t.record?.overall?.pointsFor ?? 0;
    const r: Roster = {
      roster_id: t.id, owner_id: owner, players: pool.map((x) => x.id), starters,
      reserve: pool.filter((x) => x.slot === IR).map((x) => x.id), taxi: [],
      co_owners: (t.owners ?? []).filter((o) => o !== owner),
      settings: { wins: t.record?.overall?.wins ?? 0, losses: t.record?.overall?.losses ?? 0, ties: t.record?.overall?.ties ?? 0, fpts: Math.floor(pf), fpts_decimal: Math.round((pf - Math.floor(pf)) * 100) },
    };
    rosters.push(r);
    users.push({ user_id: owner, display_name: memberName.get(owner) || name, metadata: { team_name: name } });
    if (me && (t.owners ?? []).some((o) => clean(o) === me)) { mine = r; myTeam = name; }
  }
  const league: LeagueFull = {
    league_id: String(data.id ?? id), name: data.settings?.name ?? `ESPN league ${id}`, season, total_rosters: rosters.length,
    status: "in_season", avatar: null, roster_positions, scoring_settings,
    settings: { type: 0, playoff_week_start: (data.settings?.scheduleSettings?.matchupPeriodCount ?? 14) + 1 },
  };
  return { ok: true, league, rosters, users, players, mine, team: myTeam };
}
