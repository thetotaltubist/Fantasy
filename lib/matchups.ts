// Matchups: how many fantasy points each defense allows to a position compared with
// what those same players usually score ("points over expectation"), plus the schedule ahead.
const POS = ["QB", "RB", "WR", "TE"] as const;
type StatRow = { player_id: string; team?: string | null; opponent?: string | null; stats?: Record<string, number>; player?: { position?: string } };

export type Matchups = {
  factor: Record<string, Record<string, number>>;   // defense -> position -> multiplier (1.10 = allows 10% more than expected)
  rank: Record<string, Record<string, number>>;     // defense -> position -> 1 (toughest) .. 32 (easiest)
  schedule: Record<number, Record<string, string>>; // week -> team -> opponent
  weeksUsed: number;
};

let cached: { at: number; key: string; data: Matchups } | null = null;

async function weekStats(season: string, week: number): Promise<StatRow[]> {
  const res = await fetch(
    `https://api.sleeper.app/stats/nfl/${season}/${week}?season_type=regular&${POS.map((p) => `position[]=${p}`).join("&")}`,
    { cache: "no-store" },
  );
  return res.ok ? ((await res.json()) as StatRow[]) : [];
}
async function weekSchedule(season: string, week: number): Promise<Record<string, string>> {
  const res = await fetch(`https://api.sleeper.app/projections/nfl/${season}/${week}?season_type=regular&position[]=QB`, { cache: "no-store" });
  const out: Record<string, string> = {};
  if (res.ok) for (const r of (await res.json()) as StatRow[]) if (r.team && r.opponent) out[r.team] = r.opponent;
  return out;
}

export const LAST_WEEK = 17;   // fantasy seasons end in week 17

export async function getMatchups(season: string, currentWeek: number): Promise<Matchups> {
  const key = `${season}|${currentWeek}`;
  if (cached && cached.key === key && Date.now() - cached.at < 12 * 3600_000) return cached.data;
  const past = Array.from({ length: currentWeek }, (_, i) => i + 1);
  const future = Array.from({ length: Math.max(0, LAST_WEEK - currentWeek + 1) }, (_, i) => currentWeek + i);
  const [stats, sched] = await Promise.all([
    Promise.all(past.map((w) => weekStats(season, w).catch(() => [] as StatRow[]))),
    Promise.all(future.map((w) => weekSchedule(season, w).catch(() => ({} as Record<string, string>)))),
  ]);

  // Every game a player actually played, in half-PPR points.
  type Game = { id: string; pos: string; def: string; pts: number };
  const games: Game[] = [];
  for (const rows of stats) for (const r of rows) {
    const pos = r.player?.position ?? "", s = r.stats ?? {};
    if (!r.opponent || !POS.includes(pos as (typeof POS)[number]) || !(s.off_snp > 0)) continue;
    games.push({ id: r.player_id, pos, def: r.opponent, pts: s.pts_half_ppr ?? 0 });
  }
  const byPlayer: Record<string, Game[]> = {};
  for (const g of games) (byPlayer[g.id] ??= []).push(g);

  // For each game, compare the score with that player's average in his other games.
  const got: Record<string, Record<string, number>> = {}, expected: Record<string, Record<string, number>> = {};
  const leagueExp: Record<string, number> = {}; const leagueGames: Record<string, number> = {};
  for (const list of Object.values(byPlayer)) {
    if (list.length < 3) continue;
    const total = list.reduce((t, g) => t + g.pts, 0);
    if (total / list.length < (list[0].pos === "QB" ? 10 : 5)) continue;   // regular contributors only
    for (const g of list) {
      const exp = (total - g.pts) / (list.length - 1);
      ((got[g.def] ??= {})[g.pos] ??= 0); got[g.def][g.pos] += g.pts;
      ((expected[g.def] ??= {})[g.pos] ??= 0); expected[g.def][g.pos] += exp;
      leagueExp[g.pos] = (leagueExp[g.pos] ?? 0) + exp;
      leagueGames[g.pos] = (leagueGames[g.pos] ?? 0) + 1;
    }
  }
  const factor: Matchups["factor"] = {}, rank: Matchups["rank"] = {};
  const teams = Object.keys(expected);
  for (const pos of POS) {
    // Pull small samples toward average: add six typical team-games of "exactly as expected".
    const pad = teams.length ? (6 * (leagueExp[pos] ?? 0)) / Math.max(1, teams.length * Math.max(1, currentWeek - 1)) * 1 : 0;
    for (const t of teams) {
      const e = expected[t]?.[pos] ?? 0, g = got[t]?.[pos] ?? 0;
      const f = e + pad > 0 ? (g + pad) / (e + pad) : 1;
      (factor[t] ??= {})[pos] = Math.min(1.3, Math.max(0.75, Math.round(f * 1000) / 1000));
    }
    [...teams].sort((a, b) => factor[a][pos] - factor[b][pos]).forEach((t, i) => { (rank[t] ??= {})[pos] = i + 1; });
  }
  const schedule: Matchups["schedule"] = {};
  future.forEach((w, i) => { schedule[w] = sched[i]; });
  const data = { factor, rank, schedule, weeksUsed: stats.filter((r) => r.length).length };
  if (teams.length >= 28) cached = { at: Date.now(), key, data };
  return data;
}

// Average matchup multiplier for a team's position over a set of weeks (byes skipped).
export function outlook(m: Matchups, team: string | null | undefined, pos: string, weeks: number[]) {
  const list = weeks.map((w) => {
    const opp = team ? m.schedule[w]?.[team] : undefined;
    return { week: w, opp: opp ?? null, factor: opp ? m.factor[opp]?.[pos] ?? 1 : null, rank: opp ? m.rank[opp]?.[pos] ?? null : null };
  });
  const played = list.filter((x) => x.factor != null);
  const avg = played.length ? played.reduce((t, x) => t + (x.factor as number), 0) / played.length : 1;
  return { list, avg };
}
