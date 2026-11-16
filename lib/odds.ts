// Vegas game lines from The Odds API, turned into each team's expected points.
// implied team points = (game total / 2) - (team spread / 2)
export const NAMES: Record<string, string> = {
  "Arizona Cardinals": "ARI", "Atlanta Falcons": "ATL", "Baltimore Ravens": "BAL", "Buffalo Bills": "BUF",
  "Carolina Panthers": "CAR", "Chicago Bears": "CHI", "Cincinnati Bengals": "CIN", "Cleveland Browns": "CLE",
  "Dallas Cowboys": "DAL", "Denver Broncos": "DEN", "Detroit Lions": "DET", "Green Bay Packers": "GB",
  "Houston Texans": "HOU", "Indianapolis Colts": "IND", "Jacksonville Jaguars": "JAX", "Kansas City Chiefs": "KC",
  "Las Vegas Raiders": "LV", "Los Angeles Chargers": "LAC", "Los Angeles Rams": "LAR", "Miami Dolphins": "MIA",
  "Minnesota Vikings": "MIN", "New England Patriots": "NE", "New Orleans Saints": "NO", "New York Giants": "NYG",
  "New York Jets": "NYJ", "Philadelphia Eagles": "PHI", "Pittsburgh Steelers": "PIT", "San Francisco 49ers": "SF",
  "Seattle Seahawks": "SEA", "Tampa Bay Buccaneers": "TB", "Tennessee Titans": "TEN", "Washington Commanders": "WAS",
};

export type TeamLine = { opp: string; spread: number; total: number; implied: number; oppImplied: number };
export type Lines = { teams: Record<string, TeamLine>; average: number };

type Game = {
  commence_time: string; home_team: string; away_team: string;
  bookmakers: { markets: { key: string; outcomes: { name: string; point?: number }[] }[] }[];
};

const avg = (a: number[]) => a.reduce((s, x) => s + x, 0) / a.length;
const r1 = (n: number) => Math.round(n * 10) / 10;

export async function getLines(): Promise<Lines> {
  const empty: Lines = { teams: {}, average: 22.5 };
  const key = process.env.ODDS_API_KEY;
  if (!key) return empty;
  try {
    const res = await fetch(
      `https://api.the-odds-api.com/v4/sports/americanfootball_nfl/odds?apiKey=${key}` +
        "&regions=us&markets=spreads,totals&oddsFormat=american&bookmakers=draftkings,fanduel",
      { next: { revalidate: 3 * 3600 } },   // refresh about 8 times a day
    );
    if (!res.ok) return empty;
    const games = (await res.json()) as Game[];
    const teams: Record<string, TeamLine> = {};
    // Soonest game first, and skip games already under way (live lines are misleading).
    for (const g of [...games].sort((a, b) => a.commence_time.localeCompare(b.commence_time))) {
      if (new Date(g.commence_time).getTime() < Date.now()) continue;
      const home = NAMES[g.home_team], away = NAMES[g.away_team];
      if (!home || !away || teams[home] || teams[away]) continue;
      const homeSpreads: number[] = [], totals: number[] = [];
      for (const b of g.bookmakers) for (const m of b.markets) {
        if (m.key === "spreads") { const o = m.outcomes.find((x) => x.name === g.home_team); if (o?.point != null) homeSpreads.push(o.point); }
        if (m.key === "totals") { const o = m.outcomes[0]; if (o?.point != null) totals.push(o.point); }
      }
      if (!homeSpreads.length || !totals.length) continue;
      const spread = avg(homeSpreads), total = avg(totals);
      const hi = total / 2 - spread / 2, ai = total / 2 + spread / 2;
      teams[home] = { opp: away, spread: r1(spread), total: r1(total), implied: r1(hi), oppImplied: r1(ai) };
      teams[away] = { opp: home, spread: r1(-spread), total: r1(total), implied: r1(ai), oppImplied: r1(hi) };
    }
    const all = Object.values(teams).map((t) => t.implied);
    return { teams, average: all.length ? avg(all) : 22.5 };
  } catch { return empty; }
}

// How much to move a projection for the team's Vegas outlook.
// The base projection already accounts for matchup to a degree, so only part
// of the Vegas difference is applied: 35% for offense, 50% for kickers and defenses.
export function vegasMultiplier(lines: Lines, team: string, pos: string, projectedOpp: string | null): number {
  const t = lines.teams[team];
  if (!t || (projectedOpp && t.opp !== projectedOpp)) return 1;   // line is for a different week
  if (pos === "DEF") {
    const ratio = lines.average / Math.max(10, t.oppImplied);     // low-scoring opponent is good
    return clamp(1 + 0.5 * (ratio - 1));
  }
  const ratio = t.implied / lines.average;
  return clamp(1 + (pos === "K" ? 0.5 : 0.35) * (ratio - 1));
}
const clamp = (x: number) => Math.min(1.2, Math.max(0.8, x));
