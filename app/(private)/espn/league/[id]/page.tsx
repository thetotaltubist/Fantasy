import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { getNflState, getPlayers } from "@/lib/sleeper";
import { ESPN_COOKIE, parseCreds, getEspnLeague } from "@/lib/espn";
import { LeagueView } from "@/app/_views/league-view";

export default async function EspnLeaguePage({ params, searchParams }: {
  params: Promise<{ id: string }>; searchParams: Promise<{ week?: string }>;
}) {
  const { id } = await params;
  const { week: weekParam } = await searchParams;
  const creds = parseCreds((await cookies()).get(ESPN_COOKIE)?.value);
  if (!creds) redirect("/espn");
  if (!creds.ids.includes(id)) notFound();
  const [state, sleeperPlayers] = await Promise.all([getNflState(), getPlayers()]);
  const results = await Promise.all(creds.ids.map((x) => getEspnLeague(x, state.season, creds, sleeperPlayers)));
  const r = results.find((x) => x.ok && x.league.league_id === id);
  if (!r || !r.ok || !r.mine) redirect("/espn");
  const nav = results.flatMap((x) => x.ok ? [{ href: `/espn/league/${x.league.league_id}`, label: x.league.name.trim(), active: x.league.league_id === id }] : []);
  return <LeagueView league={r.league} rosters={r.rosters} users={r.users} players={r.players} mine={r.mine} team={r.team}
    state={state} weekParam={weekParam} nav={nav} site="ESPN" allHref="/espn" />;
}
