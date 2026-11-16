import Link from "next/link";
import { notFound } from "next/navigation";
import {
  getUser, getNflState, getLeagues, getRosters, getLeagueUsers, getPlayers,
  rosterOf, record, points, rankOf, ordinal, formatTags, isBad, isConcern, playerName,
  type LeagueFull,
} from "@/lib/sleeper";

export default async function Leagues({ params }: { params: Promise<{ username: string }> }) {
  const { username } = await params;
  const user = await getUser(decodeURIComponent(username));
  if (!user) notFound();
  const state = await getNflState();
  const [leagues, players] = await Promise.all([
    getLeagues(user.user_id, state.season) as Promise<LeagueFull[]>, getPlayers(),
  ]);

  const rows = (await Promise.all(leagues.map(async (l) => {
    const [rosters, users] = await Promise.all([getRosters(l.league_id), getLeagueUsers(l.league_id)]);
    const mine = rosterOf(rosters, user.user_id);
    if (!mine) return null;
    const team = users.find((u) => u.user_id === user.user_id)?.metadata?.team_name;
    const starters = (mine.starters ?? []).filter((id) => id !== "0");
    const out = starters.filter((id) => isBad(players[id]));
    const q = starters.filter((id) => isConcern(players[id]) && !isBad(players[id]));
    const empty = (mine.starters ?? []).filter((id) => id === "0").length;
    return {
      l, team, mine, rank: rankOf(rosters, mine), size: rosters.length,
      out: out.map((id) => playerName(players[id], id)), q: q.length, empty,
    };
  }))).filter((r): r is NonNullable<typeof r> => r !== null)
    .sort((a, b) => a.l.name.localeCompare(b.l.name));

  const w = rows.reduce((s, r) => s + r.mine.settings.wins, 0);
  const lo = rows.reduce((s, r) => s + r.mine.settings.losses, 0);
  const needFix = rows.filter((r) => r.out.length || r.empty).length;
  const dupes = new Set(rows.map((r) => r.l.name).filter((n, i, a) => a.indexOf(n) !== i));

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <p className="muted text-xs uppercase tracking-wide">Sleeper · Week {state.week}</p>
          <h1 className="text-xl font-bold">My leagues</h1>
        </div>
        <Link href="/?change=1" className="muted text-xs underline">Not {user.display_name}?</Link>
      </div>

      <div className="grid grid-cols-3 gap-2 mt-4 text-center">
        <Stat label="Leagues" value={String(rows.length)} />
        <Stat label="Overall record" value={`${w}-${lo}`} />
        <Stat label="Lineups to fix" value={String(needFix)} alert={needFix > 0} />
      </div>

      <div className="card mt-4 overflow-hidden">
        <div className="hidden sm:grid grid-cols-[1fr_5rem_5rem_5rem_9rem] gap-2 px-4 py-2 text-xs muted border-b line">
          <span>League</span><span className="text-right">Record</span><span className="text-right">Rank</span>
          <span className="text-right">Points</span><span className="text-right">Lineup</span>
        </div>
        {rows.map((r) => (
          <Link key={r.l.league_id} href={`/sleeper/${username}/league/${r.l.league_id}`}
            className="grid grid-cols-[1fr_auto] sm:grid-cols-[1fr_5rem_5rem_5rem_9rem] gap-x-2 gap-y-1 items-center px-4 py-2.5 border-b line last:border-0 hover:bg-black/[.03] dark:hover:bg-white/[.04]">
            <div className="min-w-0">
              <div className="font-semibold truncate">
                {r.l.name}{dupes.has(r.l.name) && r.team ? <span className="muted font-normal"> · {r.team}</span> : null}
              </div>
              <div className="muted text-xs truncate">{r.size} teams · {formatTags(r.l).join(" · ")}</div>
            </div>
            <div className="text-right sm:hidden text-sm">
              <b>{record(r.mine)}</b> <span className="muted">· {ordinal(r.rank)}</span>
            </div>
            <span className="hidden sm:block text-right font-semibold tabular-nums">{record(r.mine)}</span>
            <span className="hidden sm:block text-right tabular-nums">{ordinal(r.rank)}<span className="muted text-xs">/{r.size}</span></span>
            <span className="hidden sm:block text-right tabular-nums muted">{points(r.mine).toFixed(0)}</span>
            <span className="col-span-2 sm:col-span-1 sm:text-right text-xs">
              {r.out.length || r.empty ? (
                <span className="font-semibold text-red-500" title={r.out.join(", ")}>
                  {r.out.length ? `${r.out.length} injured starter${r.out.length > 1 ? "s" : ""}` : ""}
                  {r.out.length && r.empty ? " · " : ""}
                  {r.empty ? `${r.empty} empty` : ""}
                </span>
              ) : r.q ? (
                <span className="text-amber-500 font-semibold">{r.q} questionable</span>
              ) : (
                <span style={{ color: "var(--brand)" }} className="font-semibold">Set</span>
              )}
            </span>
          </Link>
        ))}
        {rows.length === 0 && <p className="p-5">No {state.season} leagues found for this username.</p>}
      </div>
    </div>
  );
}

function Stat({ label, value, alert }: { label: string; value: string; alert?: boolean }) {
  return (
    <div className="card py-2.5">
      <div className={`text-lg font-bold tabular-nums ${alert ? "text-red-500" : ""}`}>{value}</div>
      <div className="muted text-xs">{label}</div>
    </div>
  );
}
