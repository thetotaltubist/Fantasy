// The league switcher shown on every league page: all Sleeper and ESPN leagues together.
import { cookies } from "next/headers";
import { getUser, getLeagues, type Player } from "@/lib/sleeper";
import { ESPN_COOKIE, parseCreds, getEspnLeague } from "@/lib/espn";

export async function allLeaguesNav(season: string, players: Record<string, Player>, activeHref: string) {
  const jar = await cookies();
  const username = jar.get("fhq_sleeper")?.value;
  const creds = parseCreds(jar.get(ESPN_COOKIE)?.value);
  const [sleeper, espn] = await Promise.all([
    (async () => {
      if (!username) return [];
      try {
        const user = await getUser(username);
        if (!user) return [];
        return (await getLeagues(user.user_id, season)).map((l) => ({ href: `/sleeper/${encodeURIComponent(username)}/league/${l.league_id}`, label: l.name.trim() }));
      } catch { return []; }
    })(),
    Promise.all((creds?.ids ?? []).map(async (id) => {
      const r = await getEspnLeague(id, season, creds!, players);
      return r.ok ? { href: `/espn/league/${r.league.league_id}`, label: r.league.name.trim() } : null;
    })),
  ]);
  const nav = [...sleeper, ...espn.filter((x): x is { href: string; label: string } => x !== null)]
    .sort((a, b) => a.label.localeCompare(b.label))
    .map((x) => ({ ...x, active: x.href === activeHref }));
  return { nav, allHref: username ? `/sleeper/${encodeURIComponent(username)}` : "/espn" };
}
