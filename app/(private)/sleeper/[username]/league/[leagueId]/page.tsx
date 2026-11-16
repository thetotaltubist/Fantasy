import { notFound } from "next/navigation";
import {
  getUser, getNflState, getLeagues, getLeague, getRosters, getLeagueUsers, getPlayers, rosterOf, type LeagueFull,
} from "@/lib/sleeper";
import { LeagueView } from "@/app/_views/league-view";

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
  const nav = [...all].sort((a, b) => a.name.localeCompare(b.name)).map((l) => ({
    href: `/sleeper/${username}/league/${l.league_id}`, label: l.name.trim(), active: l.league_id === leagueId,
  }));
  return <LeagueView {...{ league, rosters, users, players, mine, team, state, weekParam, nav }} site="Sleeper" allHref={`/sleeper/${username}`} />;
}
