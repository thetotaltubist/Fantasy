import Link from "next/link";
import { notFound } from "next/navigation";
import {
  getUser, getNflState, getLeagues, getLeague, getRosters, getLeagueUsers, getPlayers,
  playerName, rosterOf, record, points, rankOf, ordinal, slotLabel, formatTags, isBad,
  type Player, type LeagueFull,
} from "@/lib/sleeper";
import { waiverPicks, getTrending } from "@/lib/waivers";
import { tradeIdeas } from "@/lib/trades";
import { getEcr, blendWeekly, scoringKey, MIN_EXPERTS } from "@/lib/fantasypros";
import { setRosConsensus } from "@/lib/experts";
import { expertSource } from "@/lib/experts";
import { getLines, vegasMultiplier } from "@/lib/odds";
import { getProjections, getLockedTeams, projectPoints, adviseLineup, positionOf, type Proj } from "@/lib/projections";

const POS_COLOR: Record<string, string> = {
  QB: "#ef4444", RB: "#22c55e", WR: "#3b82f6", TE: "#f59e0b", K: "#a855f7", DEF: "#64748b",
};

function Row({ id, slot, p, proj, pts, played, vegas }: { id: string; slot?: string; p?: Player; proj?: Proj; pts?: number; played?: boolean; vegas?: number }) {
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
      <span className="muted text-xs shrink-0">
        {p?.team ?? ""}{proj?.opponent ? ` v ${proj.opponent}` : ""}
        {pts !== undefined && !proj?.opponent && !played && <span className="font-semibold text-amber-500"> BYE</span>}
      </span>
      {p?.injury_status && (
        <span className={`shrink-0 text-[11px] font-semibold ${bad ? "text-red-500" : "text-amber-500"}`}>
          {p.injury_status === "Questionable" ? "Q" : p.injury_status}
        </span>
      )}
      {played ? <span className="ml-auto shrink-0 text-[11px] muted">played</span>
        : pts !== undefined && (
          <span className="ml-auto shrink-0 tabular-nums text-sm font-semibold">
            {vegas !== undefined && Math.abs(vegas) >= 0.3 && (
              <span className={`text-[10px] font-normal mr-1 ${vegas > 0 ? "text-green-500" : "text-red-500"}`}
                title="Vegas adjustment">{vegas > 0 ? "▲" : "▼"}{Math.abs(vegas).toFixed(1)}</span>
            )}
            {pts.toFixed(1)}
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

export default async function LeaguePage({ params, searchParams }: {
  params: Promise<{ username: string; leagueId: string }>; searchParams: Promise<{ week?: string }>;
}) {
  const { username, leagueId } = await params;
  const { week: weekParam } = await searchParams;
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

  // Start-sit: project every player with this league's scoring, then find the best lineup.
  const week = Math.min(18, Math.max(1, Number(weekParam) || state.week));
  let projections: Record<string, Proj> = {};
  let projError = false;
  try { projections = await getProjections(state.season, week); } catch { projError = true; }
  const scoring = league.scoring_settings ?? {};
  const lines = await getLines();
  const teamFor = (id: string) => (/^[A-Z]{2,3}$/.test(id) && !players[id]?.team ? id : players[id]?.team ?? "");
  const base = (id: string) => (isBad(players[id]) ? 0 : projectPoints(projections[id], scoring));
  const mult = (id: string) => vegasMultiplier(lines, teamFor(id), positionOf(id, players[id]), projections[id]?.opponent ?? null);
  const withVegas = (id: string) => Math.round(base(id) * mult(id) * 10) / 10;
  const vegas = (id: string) => Math.round((withVegas(id) - base(id)) * 10) / 10;
  // Expert consensus from FantasyPros: weekly ranks for start-sit, rest-of-season for waivers and trades.
  const sk = scoringKey(scoring);
  const [weekly, ros] = await Promise.all([getEcr(state.season, "weekly", week, sk), getEcr(state.season, "ros", 0, "HALF")]);
  setRosConsensus(ros);
  const pts = blendWeekly(Object.keys(projections), players, withVegas, weekly);
  const weeklyUsed = weekly.experts >= MIN_EXPERTS;
  const hasLines = Object.keys(lines.teams).length > 0;

  // Waivers: best unrostered players over the next three weeks vs. your weakest bench spots.
  const [next1, next2, trending] = await Promise.all([
    getProjections(state.season, Math.min(18, week + 1)).catch(() => ({})),
    getProjections(state.season, Math.min(18, week + 2)).catch(() => ({})),
    getTrending(),
  ]);
  const picks = projError ? [] : waiverPicks({
    rosters, mine, players, weeks: [projections, next1, next2], scoring,
    slots: league.roster_positions, trending,
  });
  const trades = projError ? [] : tradeIdeas({
    rosters, mine, players, weeks: [projections, next1, next2], scoring, slots: league.roster_positions,
  });
  const ownerName = (rosterId: number) => {
    const r = rosters.find((x) => x.roster_id === rosterId);
    const u = users.find((x) => x.user_id === r?.owner_id);
    return u?.metadata?.team_name?.trim() || u?.display_name || `Team ${rosterId}`;
  };
  const bestBall = !!league.settings?.best_ball;
  const lockedTeams = await getLockedTeams(state.season, week);
  const teamOf = (id: string) => (positionOf(id, players[id]) === "DEF" ? id : players[id]?.team ?? "");
  const locked = (id: string) => lockedTeams.has(teamOf(id));
  const allLocked = starters.filter((id) => id !== "0").every(locked);
  const advice = adviseLineup({ slots, starters, candidates: [...starters.filter((id) => id !== "0"), ...bench], players, pts, locked });
  const name = (id: string) => playerName(players[id], id);
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

      <section className="card px-4 py-3 mt-3">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4">
          <h2 className="text-sm font-semibold">Start-sit for Week {week}</h2>
          <p className="text-xs muted">
            {week === state.week
              ? <Link className="underline" href={`?week=${Math.min(18, state.week + 1)}`}>Look ahead to Week {Math.min(18, state.week + 1)}</Link>
              : <Link className="underline" href="?">Back to Week {state.week}</Link>}
          </p>
        </div>
        {projError ? (
          <p className="text-sm muted mt-1">Projections aren&apos;t available right now.</p>
        ) : bestBall ? (
          <p className="text-sm muted mt-1">Best ball league: your lineup sets itself. Projected {advice.best.toFixed(1)} pts.</p>
        ) : allLocked ? (
          <p className="text-sm muted mt-1">All your starters have played, so this week&apos;s lineup is locked. Look ahead to next week.</p>
        ) : advice.swaps.filter((w) => w.gain >= 0.5).length === 0 ? (
          <p className="text-sm mt-1">
            <b style={{ color: "var(--brand)" }}>Your lineup is the best one available.</b>{" "}
            <span className="muted">Projected {advice.current.toFixed(1)} pts.</span>
          </p>
        ) : (
          <>
            <p className="text-sm mt-1">
              Projected <b>{advice.current.toFixed(1)}</b> pts now, <b>{advice.best.toFixed(1)}</b> with these changes{" "}
              <b style={{ color: "var(--brand)" }}>(+{advice.gain.toFixed(1)})</b>
            </p>
            <ul className="mt-2">
              {advice.swaps.filter((w) => w.gain >= 0.5).map((w) => (
                <li key={w.inId} className="flex flex-wrap items-baseline gap-x-2 py-1.5 border-t line text-sm">
                  <span><b>Start</b> {name(w.inId)} <span className="muted text-xs">{pts(w.inId).toFixed(1)}</span></span>
                  <span>{w.outId === "0" ? <span className="muted">in the empty slot</span> : <><b>Sit</b> {name(w.outId)} <span className="muted text-xs">{pts(w.outId).toFixed(1)}</span></>}</span>
                  <span className="ml-auto font-semibold tabular-nums" style={{ color: "var(--brand)" }}>+{w.gain.toFixed(1)}</span>
                </li>
              ))}
            </ul>
          </>
        )}
        <p className="text-[11px] muted mt-2">Projections from Sleeper (Rotowire), scored with this league&apos;s rules{hasLines ? ", then nudged by Vegas spreads and totals (▲▼ shows the change)" : ""}.{" "}
          {weeklyUsed ? `Then blended half and half with the FantasyPros weekly consensus of ${weekly.experts} experts (updated ${weekly.updated}).`
            : weekly.experts > 0 ? `Only ${weekly.experts} FantasyPros experts have ranked this week so far, so their consensus joins in once at least ${MIN_EXPERTS} have.`
            : "FantasyPros weekly rankings aren't loaded."}</p>
      </section>

      <section className="card px-4 py-3 mt-3">
        <h2 className="text-sm font-semibold">Waiver targets</h2>
        {picks.length === 0 ? (
          <p className="text-sm muted mt-1">Nothing on the wire clearly beats what you have.</p>
        ) : (
          <ul className="mt-1">
            {picks.map((w) => (
              <li key={w.addId} className="flex flex-wrap items-baseline gap-x-2 py-1.5 border-t line first:border-0 text-sm">
                <span className="w-8 shrink-0 text-center text-[10px] font-bold py-0.5 rounded text-white"
                  style={{ background: POS_COLOR[w.pos] ?? "#94a3b8" }}>{w.pos}</span>
                <span><b>Add</b> {name(w.addId)} <span className="muted text-xs">{players[w.addId]?.team ?? ""} · {w.addAvg.toFixed(1)}/gm{w.addRank ? ` · ROS ${w.pos}${w.addRank}` : ""}</span></span>
                {w.trending && <span className="text-[10px] font-semibold text-amber-500">HOT</span>}
                {w.dropId && <span><b>Drop</b> {name(w.dropId)} <span className="muted text-xs">{w.dropAvg.toFixed(1)}/gm{w.dropRank ? ` · ROS ${w.pos}${w.dropRank}` : ""}</span></span>}
                <span className="ml-auto font-semibold tabular-nums" style={{ color: "var(--brand)" }}>+{w.gain.toFixed(1)}</span>
              </li>
            ))}
          </ul>
        )}
        <p className="text-[11px] muted mt-2">Value blends projected points over the next three weeks with{" "}
          {expertSource.count ? expertSource.label : "expert rankings once uploaded"}. HOT means lots of Sleeper managers added the player in the last day.
          {league.settings?.type === 2 ? " Dynasty league: this only looks at the next few weeks, so weigh long-term value before dropping young players." : ""}</p>
      </section>

      <section className="card px-4 py-3 mt-3">
        <h2 className="text-sm font-semibold">Trade partners</h2>
        {trades.length === 0 ? (
          <p className="text-sm muted mt-1">No one-for-one trade clearly helps both teams right now.</p>
        ) : (
          <ul className="mt-1">
            {trades.map((t) => {
              const gp = positionOf(t.giveId, players[t.giveId]), rp = positionOf(t.getId, players[t.getId]);
              return (
                <li key={t.partnerId} className="py-1.5 border-t line first:border-0 text-sm">
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    <span className="font-semibold">{ownerName(t.partnerId)}</span>
                    <span className="ml-auto font-semibold tabular-nums" style={{ color: "var(--brand)" }}>+{t.myGain.toFixed(1)}</span>
                  </div>
                  <div className="flex flex-wrap items-baseline gap-x-3">
                    <span><b>Get</b> {name(t.getId)} <span className="muted text-xs">{rp} · {t.getVal.toFixed(1)}/gm{t.getRank ? ` · ROS ${rp}${t.getRank}` : ""}</span></span>
                    <span><b>Give</b> {name(t.giveId)} <span className="muted text-xs">{gp} · {t.giveVal.toFixed(1)}/gm{t.giveRank ? ` · ROS ${gp}${t.giveRank}` : ""}</span></span>
                    <span className="muted text-xs">helps them +{t.theirGain.toFixed(1)}</span>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        <p className="text-[11px] muted mt-2">Each idea swaps a player you can spare for one who would start for you, where the other team&apos;s starting lineup improves too. The green number is points per game added to your lineup. Injured players are left out.
          {league.settings?.type === 2 ? " Dynasty league: this ignores age and draft picks." : ""}</p>
      </section>

      <div className="grid md:grid-cols-2 gap-3 mt-3">
        <section className="card px-4 py-3">
          <h2 className="text-sm font-semibold mb-1">Starters</h2>
          <ul>{starters.map((id, i) => <Row key={id + i} id={id} slot={slots[i] ?? ""} p={players[id]} proj={projections[id]} pts={id === "0" ? undefined : pts(id)} played={id !== "0" && locked(id)} vegas={id === "0" ? undefined : vegas(id)} />)}</ul>
        </section>
        <section className="card px-4 py-3 self-start">
          <h2 className="text-sm font-semibold mb-1">Bench <span className="muted font-normal">({bench.length})</span></h2>
          <ul>{[...bench].sort((a, b) => pts(b) - pts(a)).map((id) => <Row key={id} id={id} p={players[id]} proj={projections[id]} pts={pts(id)} played={locked(id)} vegas={vegas(id)} />)}</ul>
          <Group title="Injured reserve" ids={reserve} players={players} />
          <Group title="Taxi squad" ids={taxi} players={players} />
        </section>
      </div>
    </div>
  );
}
