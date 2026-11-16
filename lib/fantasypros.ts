// FantasyPros official API: expert consensus rankings (ECR), weekly and rest-of-season.
import type { Player } from "@/lib/sleeper";
import { positionOf } from "@/lib/projections";
import { norm } from "@/lib/experts";

export type Ecr = {
  ranks: Map<string, number>;          // "name|POS" (or "DEF|TEAM") -> rank at the position
  depth: Record<string, number>;       // how many players are ranked at each position
  experts: number;                     // fewest experts behind any skill position
  updated: string;
  dell?: boolean;                      // Chris Dell's own list is mixed in
};
const EMPTY: Ecr = { ranks: new Map(), depth: {}, experts: 0, updated: "" };
const TEAM_FIX: Record<string, string> = { JAC: "JAX", WSH: "WAS", LVR: "LV" };

type Resp = { filters?: string; total_experts?: number; last_updated?: string; players?: { player_name: string; player_team_id: string; rank_ecr: number }[] };

export const scoringKey = (s: Record<string, number> | undefined) => {
  const rec = s?.rec ?? 0;
  return rec >= 1 ? "PPR" : rec >= 0.5 ? "HALF" : "STD";
};

async function pull(season: string, type: "weekly" | "ros", week: number, scoring: string, filters?: string): Promise<Ecr> {
  const key = process.env.FANTASYPROS_API_KEY;
  if (!key) return EMPTY;
  const positions = type === "ros" ? ["QB", "RB", "WR", "TE"] : ["QB", "RB", "WR", "TE", "K", "DST"];
  const out: Ecr = { ranks: new Map(), depth: {}, experts: Infinity, updated: "" };
  await Promise.all(positions.map(async (pos) => {
    const sc = ["RB", "WR", "TE"].includes(pos) ? scoring : "STD";   // scoring only changes these three
    const q = (type === "ros" ? `position=${pos}&scoring=${sc}&week=0&type=ros` : `position=${pos}&scoring=${sc}&week=${week}`) + (filters ? `&filters=${filters}` : "");
    try {
      const res = await fetch(`https://api.fantasypros.com/public/v2/json/nfl/${season}/consensus-rankings?${q}`, {
        headers: { "x-api-key": key }, next: { revalidate: 3 * 3600 },
      });
      if (!res.ok) return;
      const d = (await res.json()) as Resp;
      if (filters && (d.total_experts ?? 0) !== 1) return;   // the filter was ignored: he hasn't posted yet
      const mine = pos === "DST" ? "DEF" : pos;
      for (const p of d.players ?? []) {
        const k = mine === "DEF" ? `DEF|${TEAM_FIX[p.player_team_id] ?? p.player_team_id}` : `${norm(p.player_name)}|${mine}`;
        if (!out.ranks.has(k)) out.ranks.set(k, p.rank_ecr);
      }
      out.depth[mine] = d.players?.length ?? 0;
      if (["QB", "RB", "WR", "TE"].includes(pos)) out.experts = Math.min(out.experts, d.total_experts ?? 0);
      if (d.last_updated && d.last_updated > out.updated) out.updated = d.last_updated;
    } catch { /* leave this position out */ }
  }));
  if (!Number.isFinite(out.experts)) out.experts = 0;
  return out;
}

// Everyone's consensus, with Chris Dell's own list (FantasyPros expert 3556) averaged in
// at equal weight wherever he has ranked the player.
const DELL = "3556:3556";
export async function getEcr(season: string, type: "weekly" | "ros", week: number, scoring: string): Promise<Ecr> {
  const [all, dell] = await Promise.all([pull(season, type, week, scoring), pull(season, type, week, scoring, DELL)]);
  if (!dell.ranks.size) return all;
  const ranks = new Map(all.ranks);
  for (const [k, r] of dell.ranks) { const a = all.ranks.get(k); ranks.set(k, a == null ? r : (a + r) / 2); }
  const depth = { ...all.depth };
  for (const [p, n] of Object.entries(dell.depth)) depth[p] = Math.max(depth[p] ?? 0, n);
  return { ranks, depth, experts: all.experts + 1, updated: all.updated > dell.updated ? all.updated : dell.updated, dell: true };
}

export function ecrRank(ecr: Ecr, id: string, p: Player | undefined): number | null {
  const pos = positionOf(id, p);
  if (pos === "DEF") return ecr.ranks.get(`DEF|${p?.team ?? id}`) ?? null;
  const name = p?.full_name ?? `${p?.first_name ?? ""} ${p?.last_name ?? ""}`.trim();
  return name ? ecr.ranks.get(`${norm(name)}|${pos}`) ?? null : null;
}

// Weekly blend: average a player's projection rank at his position with his expert rank,
// then give him the points that blended rank is worth. Needs at least three experts.
export const MIN_EXPERTS = 3;
export function blendWeekly(ids: string[], players: Record<string, Player>, pts: (id: string) => number, ecr: Ecr) {
  if (ecr.experts < MIN_EXPERTS) return pts;
  const ladders: Record<string, number[]> = {};
  const projRank: Record<string, number> = {};
  const byPos: Record<string, { id: string; v: number }[]> = {};
  for (const id of ids) {
    const v = pts(id); if (v <= 0) continue;
    (byPos[positionOf(id, players[id])] ??= []).push({ id, v });
  }
  for (const [pos, list] of Object.entries(byPos)) {
    list.sort((a, b) => b.v - a.v);
    ladders[pos] = list.map((x) => x.v);
    list.forEach((x, i) => { projRank[x.id] = i + 1; });
  }
  const cache = new Map<string, number>();
  return (id: string) => {
    const hit = cache.get(id); if (hit !== undefined) return hit;
    const own = pts(id), pos = positionOf(id, players[id]);
    let v = own;
    const ladder = ladders[pos];
    if (own > 0 && ladder && ecr.depth[pos] && projRank[id]) {
      const er = ecrRank(ecr, id, players[id]) ?? ecr.depth[pos] + 10;   // unranked = below the list
      const b = Math.min(ladder.length, Math.max(1, Math.round((projRank[id] + er) / 2)));
      v = Math.round(ladder[b - 1] * 10) / 10;
    }
    cache.set(id, v);
    return v;
  };
}
