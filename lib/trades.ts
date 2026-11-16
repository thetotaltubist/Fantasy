// Trade partners: one-for-one swaps that make both starting lineups better.
import type { Player, Roster } from "@/lib/sleeper";
import { ELIGIBLE, positionOf, type Proj } from "@/lib/projections";
import { expertRank } from "@/lib/experts";
import { makeValuer } from "@/lib/value";

export type TradeIdea = {
  partnerId: number;                 // roster_id of the other team
  giveId: string; getId: string;
  giveVal: number; getVal: number;   // blended points per game
  giveRank: number | null; getRank: number | null;
  myGain: number; theirGain: number; // change in each starting lineup, points per game
};

const r1 = (n: number) => Math.round(n * 10) / 10;

// Total value of the best starting lineup these players can make.
function bestTotal(slots: string[], ids: string[], pos: (id: string) => string, val: (id: string) => number) {
  const left = [...ids].sort((a, b) => val(b) - val(a));
  const order = slots.filter((s) => ELIGIBLE[s]).sort((a, b) => ELIGIBLE[a].length - ELIGIBLE[b].length);
  let total = 0;
  for (const s of order) {
    const i = left.findIndex((id) => ELIGIBLE[s].includes(pos(id)));
    if (i >= 0) total += val(left.splice(i, 1)[0]);
  }
  return total;
}

export function tradeIdeas(opts: {
  rosters: Roster[]; mine: Roster; players: Record<string, Player>;
  weeks: Record<string, Proj>[]; scoring: Record<string, number>; slots: string[]; limit?: number;
}): TradeIdea[] {
  const { rosters, mine, players, weeks, scoring, slots } = opts;
  const { value } = makeValuer(players, weeks, scoring);
  const cache = new Map<string, number>();
  const val = (id: string) => { let v = cache.get(id); if (v === undefined) { v = value(id); cache.set(id, v); } return v; };
  const pos = (id: string) => positionOf(id, players[id]);
  const SKILL = new Set(["QB", "RB", "WR", "TE"]);
  // Tradeable: healthy skill players with real value. Injured players are left out because
  // their value here would read as zero, which isn't what a trade partner would think.
  const pieces = (r: Roster) => {
    const reserve = new Set([...(r.reserve ?? []), ...(r.taxi ?? [])]);
    return (r.players ?? []).filter((id) => SKILL.has(pos(id)) && !reserve.has(id) && !players[id]?.injury_status && val(id) >= 4);
  };
  const lineupIds = (r: Roster) => (r.players ?? []).filter((id) => !(r.reserve ?? []).includes(id) && !(r.taxi ?? []).includes(id));

  const myIds = lineupIds(mine), myBase = bestTotal(slots, myIds, pos, val), myPieces = pieces(mine);
  // Replacement level: the best player at each position who wouldn't start for an average team.
  const need: Record<string, number> = { QB: 0, RB: 0, WR: 0, TE: 0 };
  for (const sl of slots) {
    const e = ELIGIBLE[sl]; if (!e) continue;
    if (e.length === 1) { if (e[0] in need) need[e[0]] += 1; }
    else if (e.includes("QB")) need.QB += 1;
    else { const f = e.filter((x) => x !== "TE"); for (const x of f) need[x] += 1 / f.length; }
  }
  const repl: Record<string, number> = {};
  for (const p of Object.keys(need)) {
    const vals = rosters.flatMap((r) => lineupIds(r)).filter((id) => pos(id) === p).map(val).sort((x, y) => y - x);
    repl[p] = vals[Math.round(need[p] * rosters.length)] ?? 0;
  }
  const ideas: TradeIdea[] = [];
  for (const t of rosters) {
    if (t.roster_id === mine.roster_id) continue;
    const tIds = lineupIds(t), tBase = bestTotal(slots, tIds, pos, val);
    let best: TradeIdea | null = null;
    for (const a of myPieces) for (const b of pieces(t)) {
      if (pos(a) === pos(b)) continue;                       // same-position swaps can't help both sides
      const va = val(a), vb = val(b);
      // Keep it a fair offer: compare value above a replacement-level starter, so a backup
      // quarterback's raw points don't make him look equal to a starting receiver.
      const xa = Math.max(0, va - (repl[pos(a)] ?? 0)), xb = Math.max(0, vb - (repl[pos(b)] ?? 0));
      if (Math.abs(xa - xb) > Math.max(2, 0.35 * Math.max(xa, xb))) continue;
      const myGain = bestTotal(slots, [...myIds.filter((x) => x !== a), b], pos, val) - myBase;
      if (myGain < 1) continue;
      const theirGain = bestTotal(slots, [...tIds.filter((x) => x !== b), a], pos, val) - tBase;
      if (theirGain < 1) continue;
      const idea: TradeIdea = {
        partnerId: t.roster_id, giveId: a, getId: b, giveVal: va, getVal: vb,
        giveRank: expertRank(players[a])?.rank ?? null, getRank: expertRank(players[b])?.rank ?? null,
        myGain: r1(myGain), theirGain: r1(theirGain),
      };
      // Best for this partner = the swap that helps the less-helped side the most.
      if (!best || Math.min(idea.myGain, idea.theirGain) > Math.min(best.myGain, best.theirGain)) best = idea;
    }
    if (best) ideas.push(best);
  }
  return ideas.sort((x, y) => y.myGain - x.myGain).slice(0, opts.limit ?? 4);
}
