// Expert rest-of-season rankings (uploaded files, kept out of the public repo).
import raw from "@/private-data/footballers-ros.json";
import type { Player } from "@/lib/sleeper";

type Row = { name: string; team: string; pos: string; rank: number; flex: number | null };
const data = raw as { source: string; asOf: string; players: Row[] };

// "Kenneth Walker III" and "Kenneth Walker" should match; so should "D'Andre" and "DAndre".
const norm = (s: string) =>
  s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/\b(jr|sr|ii|iii|iv|v)\b\.?/g, "").replace(/[^a-z]/g, "");

const byKey = new Map<string, Row>();
for (const r of data.players) byKey.set(`${norm(r.name)}|${r.pos}`, r);

export const expertSource = { name: data.source, asOf: data.asOf, count: data.players.length };

// How deep each position's list goes (e.g. 75 running backs).
export const expertDepth: Record<string, number> = {};
for (const r of data.players) expertDepth[r.pos] = Math.max(expertDepth[r.pos] ?? 0, r.rank);

export function expertRank(p: Player | undefined, fallbackName?: string): Row | null {
  const name = p?.full_name ?? `${p?.first_name ?? ""} ${p?.last_name ?? ""}`.trim() ?? fallbackName ?? "";
  if (!name || !p?.position) return null;
  return byKey.get(`${norm(name)}|${p.position}`) ?? null;
}
