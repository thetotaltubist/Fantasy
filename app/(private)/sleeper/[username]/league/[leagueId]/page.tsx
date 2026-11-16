import Link from "next/link";
import { notFound } from "next/navigation";
import {
  getUser, getNflState, getLeagues, getLeague, getRosters, getLeagueUsers, getPlayers,
  playerName, rosterOf, record, points, rankOf, ordinal, slotLabel, formatTags, isBad,
  type Player, type LeagueFull,
} from "@/lib/sleeper";

const POS_COLOR: Record<string, string> = {
  QB: "#ef4444", RB: "#22c55e", WR: "#3b82f6", TE: "#f59e0b", K: "#a855f7", DEF: "#64748b",
};

function Row({ id, slot, p }: { id: string; slot?: string; p?: Player }) {
  if (id === "0") {
    return (
      <li className="flex items-center gap-2 py-1.5 border-b line last:border-0 text-sm">
        <span className="w-10 shrink-0 text-[11px] font-semibold muted">{slotLabel(slot)}</span>
        <span className="text-red-500 font-semibold">Empty slot</span>
      </li>
    );
  }
  const pos = p?.position ?? (/^[A-Z]{2,3}$/.test(id) ? "DEF" : "?");
  const bad = isBad(p);
  return (
    <li className={`flex items-center gap-2 py-1.5 border-b line last:border-0 text-sm ${bad && slot ? "bg-red-500/5" : ""}`}>
      {slot !== undefined && <span className="w-10 shrink-0 text-[11px] font-semibold muted">{slotLabel(slot)}</span>}
      <span className="w-8 shrink-0 text-center text-[10px] font-bold py-0.5 rounded text-white"
        style={{ background: POS_COLOR[pos] ?? "#94a3b8" }}>{pos}</span>
      <span className="font-medium truncate">{playerName(p, id)}</span>
      <span className="muted text-xs shrink-0">{p?.team ?? ""}</span>
      {p?.injury_status && (
        <span className={`ml-auto shrink-0 text-[11px] font-semibold ${bad ? "text-red-500" : "text-amber-500"}`}>
          {p.injury_status === "Questionable" ? "Q" : p.injury_status}
        </span>
      )}
    </li>
  );
}

function Group({ title, ids, players, open }: { title: string; ids: string[]; players: Record<string, Player>; open?: boolean }) {
  if (ids.length === 0) return null;
  return (
    <details open={open} className="mt-3 group">
      <summary className="cursor-pointer text-sm font-semibold select-none list-none flex items-center gap-1">
        <span className="muted text-xs group-open:rotate-90 transition-transform">▶</span> {title}
        <span className="muted font-normal">({ids.length})</span>
      </summary>
      <ul className="mt-1">{ids.map((id) => <Row key={id} id={id} p={players[id]} />)}</ul>
    </details>
  );
}

export default async function LeaguePage({ params }: { params: Promise<{ username: string; leagueId: string }> }) {
  const { username, leagueId } = await params;
  const user = await getUser(decodeURIComponent(username));
  if (!user) notFound();
  const state = await getNflState();
  const [league, rosters, users, players, all] = await Promise.all([
    getLeague(leagueId) as Promise<LeagueFull>, getRosters(leagueId), getLeagueUsers(leagueId), getPlayers(),
    getLeagues(user.user_id, state.season),
  ]);
  const mine = rosterOf(rosters, user.user_id);
  if (!mine) notFound();
  const team = users.find((u) => u.user_id === user.user_id)?.metadata?.team_name;

  const slots = league.roster_positions.filter((s) => s !== "BN" && s !== "IR" && s !== "TAXI");
  const starters = mine.starters ?? [];
  const reserve = mine.reserve ?? [];
  const taxi = mine.taxi ?? [];
  const bench = (mine.players ?? []).filter((id) => !starters.includes(id) && !reserve.includes(id) && !taxi.includes(id));
  const problems = starters.filter((id) => id === "0" || isBad(players[id])).length;
  const others = [...all].sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div>
      <nav className="-mx-4 px-4 flex gap-1.5 overflow-x-auto pb-2 text-xs">
        <Link href={`/sleeper/${username}`} className="shrink-0 rounded-full border line px-3 py-1 muted">All</Link>
        {others.map((l) => (
          <Link key={l.league_id} href={`/sleeper/${username}/league/${l.league_id}`}
            className={`shrink-0 rounded-full border px-3 py-1 whitespace-nowrap ${l.league_id === leagueId ? "font-semibold text-white" : "line"}`}
            style={l.league_id === leagueId ? { background: "var(--brand)", borderColor: "var(--brand)" } : undefined}>
            {l.name.trim()}
          </Link>
        ))}
      </nav>

      <div className="mt-3 flex flex-wrap items-baseline justify-between gap-x-4">
        <h1 className="text-xl font-bold">{league.name}</h1>
        <p className="text-sm">
          <b>{record(mine)}</b> <span className="muted">· {ordinal(rankOf(rosters, mine))} of {rosters.length} · {points(mine).toFixed(1)} pts</span>
        </p>
      </div>
      <p className="muted text-xs">{team ? `${team} · ` : ""}{formatTags(league).join(" · ")}</p>

      {problems > 0 && (
        <p className="mt-3 text-sm rounded-lg px-3 py-2 bg-red-500/10 text-red-500 font-semibold">
          {problems} starter{problems > 1 ? "s" : ""} injured or empty. Check your lineup in Sleeper.
        </p>
      )}

      <div className="grid md:grid-cols-2 gap-3 mt-3">
        <section className="card px-4 py-3">
          <h2 className="text-sm font-semibold mb-1">Starters</h2>
          <ul>{starters.map((id, i) => <Row key={id + i} id={id} slot={slots[i] ?? ""} p={players[id]} />)}</ul>
        </section>
        <section className="card px-4 py-3 self-start">
          <h2 className="text-sm font-semibold mb-1">Bench <span className="muted font-normal">({bench.length})</span></h2>
          <ul>{bench.map((id) => <Row key={id} id={id} p={players[id]} />)}</ul>
          <Group title="Injured reserve" ids={reserve} players={players} />
          <Group title="Taxi squad" ids={taxi} players={players} />
        </section>
      </div>
    </div>
  );
}
