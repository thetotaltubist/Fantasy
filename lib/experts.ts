// Expert rest-of-season rankings (uploaded files, kept out of the public repo).
import raw from "@/private-data/footballers-ros.json";
import type { Player } from "@/lib/sleeper";

type Row = { name: string; team: string; pos: string; rank: number; flex: number | null };
const data = raw as { source: string; asOf: string; players: Row[] };

// "Kenneth Walker III" and "Kenneth Walker" should match; so should "D'Andre" and "DAndre".
export const norm = (s: string) =>
  s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/\b(jr|sr|ii|iii|iv|v)\b\.?/g, "").replace(/[^a-z]/g, "");

const byKey = new Map<string, Row>();
for (const r of data.players) byKey.set(`${norm(r.name)}|${r.pos}`, r);

// Two more sources from FantasyPros, loaded at request time: Chris Dell's own
// rest-of-season list, and the consensus of the other experts.
type Src = { ranks: Map<string, number>; experts: number; updated: string; top20?: string };
let others: Src | null = null, dell: Src | null = null;
export function setRosConsensus(o: Src | null, d: Src | null) {
  // Keep the last good copy if a refresh comes back empty.
  if (o && o.ranks.size) others = o;
  if (d && d.ranks.size) dell = d;
}
// The Footballers and Chris Dell each count a bit more than the whole FantasyPros group.
const WEIGHT = { footballers: 0.35, dell: 0.35, others: 0.3 };

export const expertSource = {
  get count() { return data.players.length + (others?.ranks.size ?? 0) + (dell?.ranks.size ?? 0); },
  get label() {
    const parts: string[] = [];
    if (data.players.length) parts.push(`the Fantasy Footballers (35%, ${data.asOf})`);
    if (dell) parts.push(`Chris Dell (35%, updated ${dell.updated})`);
    if (others) parts.push(`${others.top20 === "all" ? "the 10 most accurate" : `the ${others.experts}`} FantasyPros experts with rest-of-season lists (30%, updated ${others.updated})`);
    return `rest-of-season rankings from ${parts.join(", ")}`;
  },
};

// How deep each position's list goes (e.g. 75 running backs).
export const expertDepth: Record<string, number> = {};
for (const r of data.players) expertDepth[r.pos] = Math.max(expertDepth[r.pos] ?? 0, r.rank);
for (const pos of ["QB", "RB", "WR", "TE"]) expertDepth[pos] ??= 60;

// Rank at the position: the weighted average of the sources that rank the player.
export function expertRank(p: Player | undefined): { rank: number } | null {
  const name = p?.full_name ?? `${p?.first_name ?? ""} ${p?.last_name ?? ""}`.trim();
  if (!name || !p?.position) return null;
  const k = `${norm(name)}|${p.position}`;
  let sum = 0, w = 0;
  const add = (r: number | undefined, weight: number) => { if (r != null) { sum += r * weight; w += weight; } };
  add(byKey.get(k)?.rank, WEIGHT.footballers);
  add(dell?.ranks.get(k), WEIGHT.dell);
  add(others?.ranks.get(k), WEIGHT.others);
  return w ? { rank: Math.round(sum / w) } : null;
}
