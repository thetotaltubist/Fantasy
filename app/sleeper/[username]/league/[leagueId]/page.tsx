import Link from "next/link";
import { notFound } from "next/navigation";
import { getUser, getLeague, getRosters, getLeagueUsers, getPlayers, playerName, rosterOf, record, slotLabel, type Player } from "@/lib/sleeper";

const POS_COLOR: Record<string, string> = {
  QB: "#ef4444", RB: "#22c55e", WR: "#3b82f6", TE: "#f59e0b", K: "#a855f7", DEF: "#64748b",
};

function Row({ id, slot, p }: { id: string; slot?: string; p?: Player }) {
  if (id === "0") {
    return (
      <li className="flex items-center gap-3 py-2.5 border-b line last:border-0">
        <span className="w-12 shrink-0 text-xs font-semibold muted">{slotLabel(slot)}</span>
        <span className="muted italic">Empty slot</span>
      </li>
    );
  }
  const pos = p?.position ?? (/^[A-Z]{2,3}$/.test(id) ? "DEF" : "?");
  return (
    <li className="flex items-center gap-3 py-2.5 border-b line last:border-0">
      {slot && <span className="w-12 shrink-0 text-xs font-semibold muted">{slotLabel(slot)}</span>}
      <span className="text-xs font-bold px-2 py-0.5 rounded text-white"
        style={{ background: POS_COLOR[pos] ?? "#94a3b8" }}>{pos}</span>
      <span className="font-medium truncate">{playerName(p, id)}</span>
      <span className="muted text-sm">{p?.team ?? ""}</span>
      {p?.injury_status && (
        <span className="ml-auto shrink-0 text-xs font-semibold text-red-500">{p.injury_status}</span>
      )}
    </li>
  );
}

export default async function LeaguePage({ params }: { params: Promise<{ username: string; leagueId: string }> }) {
  const { username, leagueId } = await params;
  const user = await getUser(decodeURIComponent(username));
  if (!user) notFound();
  const [league, rosters, users, players] = await Promise.all([
    getLeague(leagueId), getRosters(leagueId), getLeagueUsers(leagueId), getPlayers(),
  ]);
  const mine = rosterOf(rosters, user.user_id);
  const me = users.find((u) => u.user_id === user.user_id);
  if (!mine) notFound();

  const slots = league.roster_positions.filter((s) => s !== "BN" && s !== "IR");
  const starters = mine.starters ?? [];
  const reserve = mine.reserve ?? [];
  const taxi = mine.taxi ?? [];
  const bench = (mine.players ?? []).filter((id) => !starters.includes(id) && !reserve.includes(id) && !taxi.includes(id));
  const pts = (mine.settings.fpts ?? 0) + (mine.settings.fpts_decimal ?? 0) / 100;

  return (
    <div>
      <Link href={`/sleeper/${username}`} className="muted text-sm">← All leagues</Link>
      <h1 className="text-2xl font-bold mt-2">{me?.metadata?.team_name ?? `${user.display_name}'s team`}</h1>
      <p className="muted text-sm">{league.name} · {record(mine)} · {pts.toFixed(1)} points scored</p>
      <div className="grid md:grid-cols-2 gap-4 mt-6">
        <section className="card p-5">
          <h2 className="font-semibold mb-2">Starters</h2>
          <ul>{starters.map((id, i) => <Row key={id + i} id={id} slot={slots[i]} p={players[id]} />)}</ul>
        </section>
        <section className="card p-5">
          <h2 className="font-semibold mb-2">Bench</h2>
          <ul>{bench.map((id) => <Row key={id} id={id} p={players[id]} />)}</ul>
          {reserve.length > 0 && (
            <>
              <h2 className="font-semibold mt-5 mb-2">Injured reserve</h2>
              <ul>{reserve.map((id) => <Row key={id} id={id} p={players[id]} />)}</ul>
            </>
          )}
          {taxi.length > 0 && (
            <>
              <h2 className="font-semibold mt-5 mb-2">Taxi squad</h2>
              <ul>{taxi.map((id) => <Row key={id} id={id} p={players[id]} />)}</ul>
            </>
          )}
        </section>
      </div>
      <p className="muted text-sm mt-6">Start-sit picks, waiver adds and trade ideas will appear here in a later step.</p>
    </div>
  );
}
