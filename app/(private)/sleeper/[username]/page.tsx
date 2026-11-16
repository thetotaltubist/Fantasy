import Link from "next/link";
import { notFound } from "next/navigation";
import {
  getUser, getNflState, getLeagues, getRosters, getLeagueUsers, getPlayers,
  rosterOf, record, points, rankOf, ordinal, formatTags, isBad, isConcern, playerName,
  type LeagueFull,
} from "@/lib/sleeper";
import { getProjections, getLockedTeams, projectPoints, adviseLineup, positionOf, type Proj } from "@/lib/projections";

export default async function Leagues({ params }: { params: Promise<{ username: string }> }) {
  const { username } = await params;
  const user = await getUser(decodeURIComponent(username));
  if (!user) notFound();
  const state = await getNflState();
  const [leagues, players] = await Promise.all([
    getLeagues(user.user_id, state.season) as Promise<LeagueFull[]>, getPlayers(),
  ]);

  let projections: Record<string, Proj> = {};
  try { projections = await getProjections(state.season, state.week); } catch { /* show page without advice */ }

  const lockedTeams = await getLockedTeams(state.season, state.week);
  const locked = (id: string) => lockedTeams.has(positionOf(id, players[id]) === "DEF" ? id : players[id]?.team ?? "");

  const rows = (await Promise.all(leagues.map(async (l) => {
    const [rosters, users] = await Promise.all([getRosters(l.league_id), getLeagueUsers(l.league_id)]);
    const mine = rosterOf(rosters, user.user_id);
    if (!mine) return null;
    const team = users.find((u) => u.user_id === user.user_id)?.metadata?.team_name;
    const starters = (mine.starters ?? []).filter((id) => id !== "0");
    const out = starters.filter((id) => isBad(players[id]) && !locked(id));
    const q = starters.filter((id) => isConcern(players[id]) && !isBad(players[id]));
    const empty = (mine.starters ?? []).filter((id) => id === "0").length;
    const reserve = mine.reserve ?? [], taxi = mine.taxi ?? [];
    const benchIds = (mine.players ?? []).filter((id) => !(mine.starters ?? []).includes(id) && !reserve.includes(id) && !taxi.includes(id));
    const pts = (id: string) => (isBad(players[id]) ? 0 : projectPoints(projections[id], l.scoring_settings ?? {}));
    const advice = adviseLineup({
      slots: l.roster_positions.filter((s) => s !== "BN" && s !== "IR" && s !== "TAXI"),
      starters: mine.starters ?? [], candidates: [...starters, ...benchIds], players, pts, locked,
    });
    const gain = l.settings?.best_ball ? 0 : advice.swaps.filter((w) => w.gain >= 0.5).reduce((t, w) => t + w.gain, 0);
    return {
      gain, proj: l.settings?.best_ball ? advice.best : advice.current,
      l, team, mine, rank: rankOf(rosters, mine), size: rosters.length,
      out: out.map((id) => playerName(players[id], id)), q: q.length, empty,
    };
  }))).filter((r): r is NonNullable<typeof r> => r !== null)
    .sort((a, b) => a.l.name.localeCompare(b.l.name));

  const w = rows.reduce((s, r) => s + r.mine.settings.wins, 0);
  const lo = rows.reduce((s, r) => s + r.mine.settings.losses, 0);
  const needFix = rows.filter((r) => r.out.length || r.empty || r.gain >= 1).length;
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
        <Stat label="Lineups to improve" value={String(needFix)} alert={needFix > 0} />
      </div>

      <div className="card mt-4 overflow-hidden">
        <div className="hidden sm:grid grid-cols-[1fr_5rem_5rem_5rem_9rem] gap-2 px-4 py-2 text-xs muted border-b line">
          <span>League</span><span className="text-right">Record</span><span className="text-right">Rank</span>
          <span className="text-right">Proj.</span><span className="text-right">Start-sit</span>
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
            <span className="hidden sm:block text-right tabular-nums muted">{r.proj.toFixed(1)}</span>
            <span className="col-span-2 sm:col-span-1 sm:text-right text-xs">
              {r.gain >= 1 ? (
                <span className="font-semibold text-red-500" title={r.out.join(", ")}>
                  +{r.gain.toFixed(1)} pts available{r.out.length ? ` · ${r.out.length} hurt` : ""}
                </span>
              ) : r.out.length || r.empty ? (
                <span className="font-semibold text-red-500" title={r.out.join(", ")}>
                  {r.out.length ? `${r.out.length} injured starter${r.out.length > 1 ? "s" : ""}` : `${r.empty} empty`}
                </span>
              ) : r.q ? (
                <span className="text-amber-500 font-semibold">Best lineup · {r.q} Q</span>
              ) : (
                <span style={{ color: "var(--brand)" }} className="font-semibold">Best lineup</span>
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
