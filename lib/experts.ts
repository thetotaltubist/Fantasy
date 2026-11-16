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

// A second source: the FantasyPros rest-of-season consensus, loaded at request time.
let consensus: { ranks: Map<string, number>; depth: Record<string, number>; experts: number; updated: string; dell?: boolean } | null = null;
export function setRosConsensus(c: typeof consensus) { consensus = c && c.ranks.size ? c : null; }

export const expertSource = {
  get count() { return data.players.length + (consensus?.ranks.size ?? 0); },
  get label() {
    const parts: string[] = [];
    if (data.players.length) parts.push(`${data.source} (${data.asOf})`);
    if (consensus) parts.push(`the FantasyPros rest-of-season consensus (${consensus.experts} experts, updated ${consensus.updated}${consensus.dell ? ", with Chris Dell's list counted as half" : ""})`);
    return parts.join(" and ");
  },
};

// How deep each position's list goes (e.g. 75 running backs).
export const expertDepth: Record<string, number> = {};
for (const r of data.players) expertDepth[r.pos] = Math.max(expertDepth[r.pos] ?? 0, r.rank);
for (const pos of ["QB", "RB", "WR", "TE"]) expertDepth[pos] ??= 60;

// Rank at the position: the average of the sources that rank the player.
export function expertRank(p: Player | undefined): { rank: number } | null {
  const name = p?.full_name ?? `${p?.first_name ?? ""} ${p?.last_name ?? ""}`.trim();
  if (!name || !p?.position) return null;
  const k = `${norm(name)}|${p.position}`;
  const a = byKey.get(k)?.rank, b = consensus?.ranks.get(k);
  if (a == null && b == null) return null;
  return { rank: Math.round(a != null && b != null ? (a + b) / 2 : (a ?? b)!) };
}
