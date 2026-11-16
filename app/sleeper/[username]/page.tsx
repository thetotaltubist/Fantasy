import Link from "next/link";
import { notFound } from "next/navigation";
import { getUser, getNflState, getLeagues, getRosters, rosterOf, record } from "@/lib/sleeper";

export default async function Leagues({ params }: { params: Promise<{ username: string }> }) {
  const { username } = await params;
  const user = await getUser(decodeURIComponent(username));
  if (!user) notFound();
  const state = await getNflState();
  const leagues = await getLeagues(user.user_id, state.season);
  const records = await Promise.all(
    leagues.map(async (l) => rosterOf(await getRosters(l.league_id), user.user_id)),
  );

  return (
    <div>
      <p className="muted text-sm">Sleeper · {state.season} season · Week {state.week}</p>
      <h1 className="text-2xl font-bold mt-1">{user.display_name}&apos;s leagues</h1>
      {leagues.length === 0 && <p className="card p-5 mt-6">No {state.season} leagues found for this username.</p>}
      <div className="grid sm:grid-cols-2 gap-4 mt-6">
        {leagues.map((l, i) => {
          const r = records[i];
          return (
            <Link key={l.league_id} href={`/sleeper/${username}/league/${l.league_id}`}
              className="card p-5 hover:shadow-md transition-shadow">
              <div className="font-semibold">{l.name}</div>
              <div className="muted text-sm mt-1">{l.total_rosters} teams</div>
              {r && (
                <div className="mt-3 text-sm">
                  Record: <b>{record(r)}</b>
                </div>
              )}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
