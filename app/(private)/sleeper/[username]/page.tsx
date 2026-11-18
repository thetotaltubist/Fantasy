import Link from "next/link";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import {
  getUser, getNflState, getLeagues, getRosters, getLeagueUsers, getPlayers, rosterOf, type LeagueFull,
} from "@/lib/sleeper";
import { ESPN_COOKIE, parseCreds, getEspnLeague } from "@/lib/espn";
import { LeaguesView, type LeagueEntry } from "@/app/_views/leagues-view";

// Every league in one list: Sleeper by username, plus ESPN if it's connected in this browser.
export default async function Leagues({ params }: { params: Promise<{ username: string }> }) {
  const { username } = await params;
  const user = await getUser(decodeURIComponent(username));
  if (!user) notFound();
  const state = await getNflState();
  const creds = parseCreds((await cookies()).get(ESPN_COOKIE)?.value);
  const [leagues, players] = await Promise.all([
    getLeagues(user.user_id, state.season) as Promise<LeagueFull[]>, getPlayers(),
  ]);
  const [sleeper, espn] = await Promise.all([
    Promise.all(leagues.map(async (l): Promise<LeagueEntry | null> => {
      const [rosters, users] = await Promise.all([getRosters(l.league_id), getLeagueUsers(l.league_id)]);
      const mine = rosterOf(rosters, user.user_id);
      if (!mine) return null;
      const team = users.find((u) => u.user_id === user.user_id)?.metadata?.team_name;
      return { site: "Sleeper", href: `/sleeper/${username}/league/${l.league_id}`, l, rosters, mine, team, players };
    })),
    Promise.all((creds?.ids ?? []).map(async (id): Promise<LeagueEntry | null> => {
      const r = await getEspnLeague(id, state.season, creds!, players);
      return r.ok && r.mine ? { site: "ESPN", href: `/espn/league/${r.league.league_id}`, l: r.league, rosters: r.rosters, mine: r.mine, team: r.team, players: r.players } : null;
    })),
  ]);
  const entries = [...sleeper, ...espn].filter((e): e is LeagueEntry => e !== null);
  const failed = espn.filter((e) => e === null).length;
  return (
    <LeaguesView entries={entries} state={state} players={players} note={
      <span className="muted text-xs">
        <Link href="/?change=1" className="underline">Not {user.display_name}?</Link>
        {" · "}<Link href="/espn" className={`underline ${failed ? "text-red-500 font-semibold" : ""}`}>{creds ? (failed ? `${failed} ESPN league${failed > 1 ? "s" : ""} need attention` : "ESPN settings") : "Connect ESPN"}</Link>
      </span>
    } />
  );
}
