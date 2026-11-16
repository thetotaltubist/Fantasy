// Player props from The Odds API (yards, catches, touchdowns), folded into projections.
// Costs 6 credits per game, so it refreshes once a day.
import type { Player } from "@/lib/sleeper";
import type { Proj } from "@/lib/projections";
import { NAMES } from "@/lib/odds";
import { norm } from "@/lib/experts";

const MARKETS = ["player_pass_yds", "player_pass_tds", "player_rush_yds", "player_reception_yds", "player_receptions", "player_anytime_td"];
const STAT: Record<string, string> = {
  player_pass_yds: "pass_yd", player_pass_tds: "pass_td", player_rush_yds: "rush_yd",
  player_reception_yds: "rec_yd", player_receptions: "rec", player_anytime_td: "td",
};
export type Prop = { teams: [string, string]; stats: Record<string, number> };
export type Props = { players: Map<string, Prop>; games: number };

type Outcome = { name: string; description?: string; price: number; point?: number };
type EventOdds = { home_team: string; away_team: string; bookmakers?: { markets: { key: string; outcomes: Outcome[] }[] }[] };

const prob = (american: number) => (american < 0 ? -american / (-american + 100) : 100 / (american + 100));
const mean = (a: number[]) => a.reduce((s, x) => s + x, 0) / a.length;

let memo: { at: number; data: Props } | null = null;

export async function getProps(): Promise<Props> {
  const empty: Props = { players: new Map(), games: 0 };
  const key = process.env.ODDS_API_KEY;
  if (!key) return empty;
  if (memo && Date.now() - memo.at < 12 * 3600_000) return memo.data;
  try {
    const base = "https://api.the-odds-api.com/v4/sports/americanfootball_nfl/events";
    const evRes = await fetch(`${base}?apiKey=${key}`, { next: { revalidate: 6 * 3600 } });   // this list is free
    if (!evRes.ok) return empty;
    const now = Date.now();
    const events = ((await evRes.json()) as { id: string; commence_time: string }[])
      .filter((e) => { const t = new Date(e.commence_time).getTime(); return t > now && t < now + 7 * 86400_000; });
    const out: Props = { players: new Map(), games: 0 };
    await Promise.all(events.map(async (e) => {
      const res = await fetch(
        `${base}/${e.id}/odds?apiKey=${key}&regions=us&oddsFormat=american&bookmakers=draftkings,fanduel&markets=${MARKETS.join(",")}`,
        { next: { revalidate: 24 * 3600 } },
      );
      if (!res.ok) return;
      const g = (await res.json()) as EventOdds;
      const home = NAMES[g.home_team], away = NAMES[g.away_team];
      if (!home || !away) return;
      // Collect every book's number for each player and stat, then average them.
      const seen: Record<string, Record<string, number[]>> = {};
      for (const b of g.bookmakers ?? []) for (const m of b.markets) {
        const stat = STAT[m.key]; if (!stat) continue;
        const byPlayer: Record<string, Outcome[]> = {};
        for (const o of m.outcomes) if (o.description) (byPlayer[o.description] ??= []).push(o);
        for (const [name, list] of Object.entries(byPlayer)) {
          let v: number | null = null;
          if (stat === "td") {
            const yes = list.find((o) => o.name === "Yes");
            if (yes) v = -Math.log(1 - Math.min(0.9, prob(yes.price) * 0.93));   // chance of scoring -> expected touchdowns
          } else {
            const over = list.find((o) => o.name === "Over"), under = list.find((o) => o.name === "Under");
            if (over?.point != null) {
              v = over.point;
              // Passing TD lines are coarse (0.5, 1.5, 2.5): lean by how lopsided the odds are.
              if (stat === "pass_td" && under) { const po = prob(over.price), pu = prob(under.price); v += (po / (po + pu) - 0.5) * 1.6; }
            }
          }
          if (v != null) ((seen[norm(name)] ??= {})[stat] ??= []).push(v);
        }
      }
      for (const [name, stats] of Object.entries(seen)) {
        const avg: Record<string, number> = {};
        for (const [s, vals] of Object.entries(stats)) avg[s] = mean(vals);
        out.players.set(name, { teams: [home, away], stats: avg });
      }
      if (Object.keys(seen).length) out.games += 1;
    }));
    if (out.players.size) memo = { at: Date.now(), data: out };
    return out;
  } catch { return empty; }
}

// Move each projected stat halfway to its prop line. Only for the game the line is for.
export function applyProps(projections: Record<string, Proj>, players: Record<string, Player>, props: Props) {
  if (!props.players.size) return { projections, used: 0 };
  const out: Record<string, Proj> = { ...projections };
  let used = 0;
  for (const [id, proj] of Object.entries(projections)) {
    const p = players[id];
    const name = p?.full_name ?? `${p?.first_name ?? ""} ${p?.last_name ?? ""}`.trim();
    const prop = name ? props.players.get(norm(name)) : undefined;
    if (!prop || !p?.team || !prop.teams.includes(p.team) || !proj.opponent || !prop.teams.includes(proj.opponent)) continue;
    const s = { ...proj.stats };
    for (const k of ["pass_yd", "pass_td", "rush_yd", "rec_yd", "rec"]) if (prop.stats[k] != null) s[k] = ((s[k] ?? 0) + prop.stats[k]) / 2;
    if (prop.stats.td != null) {
      const cur = (s.rush_td ?? 0) + (s.rec_td ?? 0), target = (cur + prop.stats.td) / 2;
      if (cur > 0) { const f = target / cur; s.rush_td = (s.rush_td ?? 0) * f; s.rec_td = (s.rec_td ?? 0) * f; }
      else if (p.position === "RB" || p.position === "QB") s.rush_td = target; else s.rec_td = target;
    }
    out[id] = { ...proj, stats: s };
    used += 1;
  }
  return { projections: out, used };
}
