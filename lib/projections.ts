// Weekly projections from Sleeper's projections feed (supplied by Rotowire),
// re-scored with each league's own scoring settings.
import type { Player } from "@/lib/sleeper";

export type Proj = { stats: Record<string, number>; opponent: string | null };

const cache = new Map<string, { at: number; data: Record<string, Proj> }>();

export async function getProjections(season: string, week: number): Promise<Record<string, Proj>> {
  const key = `${season}-${week}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < 30 * 60_000) return hit.data;
  const pos = ["QB", "RB", "WR", "TE", "K", "DEF"].map((p) => `position[]=${p}`).join("&");
  const res = await fetch(
    `https://api.sleeper.app/projections/nfl/${season}/${week}?season_type=regular&${pos}`,
    { cache: "no-store" },
  );
  if (!res.ok) throw new Error(`Sleeper projections failed: ${res.status}`);
  const rows = (await res.json()) as { player_id: string; opponent: string | null; stats: Record<string, number> }[];
  const data: Record<string, Proj> = {};
  for (const r of rows) data[r.player_id] = { stats: r.stats ?? {}, opponent: r.opponent ?? null };
  cache.set(key, { at: Date.now(), data });
  return data;
}

// Teams whose game this week has already kicked off. Their players are locked.
const lockCache = new Map<string, { at: number; data: Set<string> }>();
export async function getLockedTeams(season: string, week: number): Promise<Set<string>> {
  const key = `${season}-${week}`;
  const hit = lockCache.get(key);
  if (hit && Date.now() - hit.at < 5 * 60_000) return hit.data;
  const data = new Set<string>();
  try {
    const res = await fetch(
      `https://api.sleeper.app/stats/nfl/${season}/${week}?season_type=regular&position[]=QB&position[]=K`,
      { cache: "no-store" },
    );
    if (res.ok) for (const r of (await res.json()) as { team?: string | null }[]) if (r.team) data.add(r.team);
  } catch { /* treat as nothing locked */ }
  lockCache.set(key, { at: Date.now(), data });
  return data;
}

// Points = each projected stat times what the league pays for it.
export function projectPoints(p: Proj | undefined, scoring: Record<string, number>): number {
  if (!p) return 0;
  let pts = 0;
  for (const [stat, value] of Object.entries(p.stats)) {
    const w = scoring[stat];
    if (w && typeof value === "number") pts += w * value;
  }
  return Math.round(pts * 10) / 10;
}

const ELIGIBLE: Record<string, string[]> = {
  QB: ["QB"], RB: ["RB"], WR: ["WR"], TE: ["TE"], K: ["K"], DEF: ["DEF"],
  FLEX: ["RB", "WR", "TE"], REC_FLEX: ["WR", "TE"], WRRB_FLEX: ["RB", "WR"],
  SUPER_FLEX: ["QB", "RB", "WR", "TE"],
};

export const positionOf = (id: string, p?: Player) =>
  p?.position ?? (/^[A-Z]{2,3}$/.test(id) ? "DEF" : "?");

export type Swap = { slot: string; inId: string; outId: string; gain: number };
export type LineupAdvice = {
  current: number; best: number; gain: number;
  bestIds: string[];          // best starter for each slot, in slot order ("0" = nobody)
  swaps: Swap[];              // who to start instead of whom
};

// Finds the highest-projected legal lineup from the players available,
// then pairs up who comes in with who goes out.
export function adviseLineup(opts: {
  slots: string[]; starters: string[]; candidates: string[];
  players: Record<string, Player>; pts: (id: string) => number;
  locked?: (id: string) => boolean;   // game already started: can't be moved
}): LineupAdvice {
  const { slots, starters, players, pts } = opts;
  const locked = opts.locked ?? (() => false);
  const candidates = opts.candidates.filter((id) => !locked(id));
  const used = new Set<string>();
  const bestIds: string[] = slots.map(() => "0");
  // Starters who already played stay exactly where they are.
  const fixed = new Set<number>();
  starters.forEach((id, i) => { if (id !== "0" && locked(id)) { bestIds[i] = id; fixed.add(i); used.add(id); } });
  // Fill the pickiest slots first so flex spots get the best leftovers.
  const order = slots.map((s, i) => ({ s, i }))
    .filter(({ s, i }) => ELIGIBLE[s] && !fixed.has(i))
    .sort((a, b) => ELIGIBLE[a.s].length - ELIGIBLE[b.s].length);
  for (const { s, i } of order) {
    let pick: string | null = null;
    for (const id of candidates) {
      if (used.has(id) || !ELIGIBLE[s].includes(positionOf(id, players[id]))) continue;
      if (pick === null || pts(id) > pts(pick)) pick = id;
    }
    if (pick) { bestIds[i] = pick; used.add(pick); }
  }
  // Slots this site doesn't understand (e.g. IDP) keep whoever is there now.
  slots.forEach((s, i) => { if (!ELIGIBLE[s] && !fixed.has(i)) bestIds[i] = starters[i] ?? "0"; });

  const sum = (ids: string[]) => ids.reduce((t, id) => t + (id === "0" ? 0 : pts(id)), 0);
  const current = sum(starters), best = sum(bestIds);

  const cur = new Set(starters.filter((id) => id !== "0"));
  const ins = bestIds.filter((id) => id !== "0" && !cur.has(id)).sort((a, b) => pts(b) - pts(a));
  const outs = starters.filter((id) => id !== "0" && !bestIds.includes(id)).sort((a, b) => pts(a) - pts(b));
  const emptySlots = starters.filter((id) => id === "0").length;
  const swaps: Swap[] = [];
  const outPool = [...outs];
  for (const inId of ins) {
    const inPos = positionOf(inId, players[inId]);
    // Prefer benching someone at the same position, else the weakest remaining starter.
    let k = outPool.findIndex((o) => positionOf(o, players[o]) === inPos);
    if (k < 0) k = 0;
    const outId = outPool.length ? outPool.splice(k, 1)[0] : "0";
    const slot = slots[bestIds.indexOf(inId)] ?? "";
    swaps.push({ slot, inId, outId, gain: Math.round((pts(inId) - (outId === "0" ? 0 : pts(outId))) * 10) / 10 });
  }
  void emptySlots;
  swaps.sort((a, b) => b.gain - a.gain);
  return { current: r1(current), best: r1(best), gain: r1(best - current), bestIds, swaps };
}

const r1 = (n: number) => Math.round(n * 10) / 10;
