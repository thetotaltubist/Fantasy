import Link from "next/link";
import { getRoster } from "@/lib/yahoo";

const POS_COLOR: Record<string, string> = {
  QB: "#ef4444", RB: "#22c55e", WR: "#3b82f6", TE: "#f59e0b", K: "#a855f7", DEF: "#64748b",
};
const BENCH = new Set(["BN", "IR", "IR+", "NA"]);

export default async function YahooTeam({ params }: { params: Promise<{ teamKey: string }> }) {
  const { teamKey } = await params;
  const { teamName, players } = await getRoster(decodeURIComponent(teamKey));
  const starters = players.filter((p) => !BENCH.has(p.slot));
  const bench = players.filter((p) => BENCH.has(p.slot));
  const row = (p: (typeof players)[number], slot: boolean) => {
    const pos = p.pos.split(",")[0];
    const bad = p.status && p.status !== "Q";
    return (
      <li key={p.key} className={`flex items-center gap-2 py-1.5 border-b line last:border-0 text-sm ${bad && slot ? "bg-red-500/5" : ""}`}>
        {slot && <span className="w-10 shrink-0 text-[11px] font-semibold muted">{p.slot}</span>}
        <span className="w-8 shrink-0 text-center text-[10px] font-bold py-0.5 rounded text-white"
          style={{ background: POS_COLOR[pos] ?? "#94a3b8" }}>{pos}</span>
        <span className="font-medium truncate">{p.name}</span>
        <span className="muted text-xs shrink-0">{p.team}</span>
        {p.status && <span className={`ml-auto shrink-0 text-[11px] font-semibold ${bad ? "text-red-500" : "text-amber-500"}`}>{p.status}</span>}
      </li>
    );
  };
  return (
    <div>
      <Link href="/yahoo" className="muted text-sm">← Yahoo leagues</Link>
      <h1 className="text-xl font-bold mt-2">{teamName}</h1>
      <div className="grid md:grid-cols-2 gap-3 mt-3">
        <section className="card px-4 py-3"><h2 className="text-sm font-semibold mb-1">Starters</h2><ul>{starters.map((p) => row(p, true))}</ul></section>
        <section className="card px-4 py-3 self-start"><h2 className="text-sm font-semibold mb-1">Bench</h2><ul>{bench.map((p) => row(p, true))}</ul></section>
      </div>
    </div>
  );
}
