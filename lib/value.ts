// One number per player: projected points per game over the next three weeks,
// blended with his expert rest-of-season rank.
import type { Player } from "@/lib/sleeper";
import { isBad } from "@/lib/sleeper";
import { projectPoints, positionOf, type Proj } from "@/lib/projections";
import { expertRank, expertDepth } from "@/lib/experts";

const r1 = (n: number) => Math.round(n * 10) / 10;

export function makeValuer(players: Record<string, Player>, weeks: Record<string, Proj>[], scoring: Record<string, number>) {
  // Average projected points per game over the weeks the player actually plays.
  const avg = (id: string) => {
    if (isBad(players[id])) return 0;
    const vals = weeks.map((w) => (w[id] ? projectPoints(w[id], scoring) : null)).filter((v): v is number => v !== null);
    return vals.length ? r1(vals.reduce((s, v) => s + v, 0) / vals.length) : 0;
  };
  // Average the player's projection rank at his position with his expert rank,
  // then read off the points that blended rank is worth.
  const ladders: Record<string, number[]> = {};
  const projRank: Record<string, number> = {};
  for (const pos of Object.keys(expertDepth)) {
    const list = Object.keys(weeks[0] ?? {}).filter((id) => players[id]?.position === pos)
      .map((id) => ({ id, a: avg(id) })).sort((x, y) => y.a - x.a);
    ladders[pos] = list.map((x) => x.a);
    list.forEach((x, i) => { projRank[x.id] = i + 1; });
  }
  const value = (id: string) => {
    const pos = positionOf(id, players[id]);
    const ladder = ladders[pos];
    if (!ladder?.length || isBad(players[id])) return avg(id);
    const pr = projRank[id] ?? ladder.length;
    const er = expertRank(players[id])?.rank ?? expertDepth[pos] + 15;   // unranked = below the list
    const blended = Math.min(ladder.length, Math.max(1, Math.round((pr + er) / 2)));
    return ladder[blended - 1] ?? 0;
  };
  return { avg, value };
}
