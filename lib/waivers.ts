// Waiver wire: compare the best unrostered players with the weakest spots on your bench.
import type { Player, Roster } from "@/lib/sleeper";
import { isBad } from "@/lib/sleeper";
import { projectPoints, positionOf, type Proj } from "@/lib/projections";

export type WaiverPick = {
  addId: string; dropId: string | null; pos: string;
  addAvg: number; dropAvg: number; gain: number; thisWeek: number; trending: boolean;
};

const r1 = (n: number) => Math.round(n * 10) / 10;

export function waiverPicks(opts: {
  rosters: Roster[]; mine: Roster; players: Record<string, Player>;
  weeks: Record<string, Proj>[];         // projections for this week and the next two
  scoring: Record<string, number>; slots: string[]; trending: Set<string>; limit?: number;
}): WaiverPick[] {
  const { rosters, mine, players, weeks, scoring, slots, trending } = opts;
  const owned = new Set<string>();
  for (const r of rosters) for (const id of [...(r.players ?? []), ...(r.reserve ?? []), ...(r.taxi ?? [])]) owned.add(id);

  // Average projected points per game over the weeks the player actually plays.
  const avg = (id: string) => {
    if (isBad(players[id])) return 0;
    const vals = weeks.map((w) => (w[id] ? projectPoints(w[id], scoring) : null)).filter((v): v is number => v !== null);
    return vals.length ? r1(vals.reduce((s, v) => s + v, 0) / vals.length) : 0;
  };
  const now = (id: string) => (isBad(players[id]) ? 0 : projectPoints(weeks[0]?.[id], scoring));

  const used = new Set(slots.filter((s) => s !== "BN"));
  const wanted = (pos: string) =>
    used.has(pos) || (["RB", "WR", "TE"].includes(pos) && (used.has("FLEX") || used.has("SUPER_FLEX"))) ||
    (pos === "QB" && used.has("SUPER_FLEX"));

  const free = Object.keys(weeks[0] ?? {})
    .filter((id) => !owned.has(id) && (players[id]?.team || /^[A-Z]{2,3}$/.test(id)))
    .map((id) => ({ id, pos: positionOf(id, players[id]), avg: avg(id) }))
    .filter((f) => wanted(f.pos) && f.avg > 0)
    .sort((a, b) => b.avg - a.avg);

  // Who you could drop: anyone not on IR or the taxi squad, weakest first.
  const reserve = new Set([...(mine.reserve ?? []), ...(mine.taxi ?? [])]);
  // Never suggest dropping an injured player: a zero projection there says nothing about his value.
  const mineIds = (mine.players ?? []).filter((id) => !reserve.has(id) && !players[id]?.injury_status);
  const droppable = mineIds.map((id) => ({ id, pos: positionOf(id, players[id]), avg: avg(id) })).sort((a, b) => a.avg - b.avg);

  const picks: WaiverPick[] = [];
  const dropped = new Set<string>();
  const perPos: Record<string, number> = {};
  for (const f of free) {
    if (picks.length >= (opts.limit ?? 6)) break;
    if ((perPos[f.pos] ?? 0) >= 2) continue;
    // Drop the weakest player at the same position; that keeps your roster balanced.
    const d = droppable.find((x) => x.pos === f.pos && !dropped.has(x.id));
    if (!d || f.avg - d.avg < 1) continue;
    dropped.add(d.id);
    perPos[f.pos] = (perPos[f.pos] ?? 0) + 1;
    picks.push({
      addId: f.id, dropId: d.id, pos: f.pos, addAvg: f.avg, dropAvg: d.avg,
      gain: r1(f.avg - d.avg), thisWeek: r1(now(f.id)), trending: trending.has(f.id),
    });
  }
  return picks.sort((a, b) => b.gain - a.gain);
}

// The most-added players across all of Sleeper in the last day.
let trendCache: { at: number; data: Set<string> } | null = null;
export async function getTrending(): Promise<Set<string>> {
  if (trendCache && Date.now() - trendCache.at < 60 * 60_000) return trendCache.data;
  const data = new Set<string>();
  try {
    const res = await fetch("https://api.sleeper.app/v1/players/nfl/trending/add?lookback_hours=24&limit=40", { cache: "no-store" });
    if (res.ok) for (const r of (await res.json()) as { player_id: string }[]) data.add(r.player_id);
  } catch { /* no trending data */ }
  trendCache = { at: Date.now(), data };
  return data;
}
