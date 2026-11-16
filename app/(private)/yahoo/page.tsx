import Link from "next/link";
import { getMyTeams, isConnected } from "@/lib/yahoo";
import { ordinal } from "@/lib/sleeper";

export default async function YahooPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  const connected = await isConnected();
  if (!connected) {
    return (
      <div className="max-w-md mx-auto pt-8">
        <h1 className="text-xl font-bold">Connect Yahoo</h1>
        <p className="muted text-sm mt-1">Sign in to Yahoo once and approve read-only access. All your Yahoo leagues come in automatically.</p>
        {error && <p className="text-sm text-red-500 mt-3">Something went wrong: {error}</p>}
        <a href="/api/yahoo/login" className="btn inline-block mt-5">Connect Yahoo</a>
      </div>
    );
  }
  let teams: Awaited<ReturnType<typeof getMyTeams>> = [];
  let loadError: string | null = null;
  try { teams = await getMyTeams(); } catch (e) { loadError = (e as Error).message; }

  return (
    <div>
      <div className="flex items-end justify-between">
        <div>
          <p className="muted text-xs uppercase tracking-wide">Yahoo</p>
          <h1 className="text-xl font-bold">My Yahoo leagues</h1>
        </div>
        <a href="/api/yahoo/login" className="muted text-xs underline">Reconnect</a>
      </div>
      {(loadError || error) && (
        <div className="card p-4 mt-4 text-sm">
          <p className="font-semibold text-red-500">Yahoo didn&apos;t share your leagues.</p>
          <p className="muted mt-1">Tap Reconnect and approve access. Details: {error ?? loadError}</p>
          <a href="/api/yahoo/login" className="btn inline-block mt-3">Reconnect Yahoo</a>
        </div>
      )}
      <div className="card mt-4 overflow-hidden">
        {teams.map((t) => (
          <Link key={t.teamKey} href={`/yahoo/${t.teamKey}`}
            className="flex items-center justify-between gap-3 px-4 py-2.5 border-b line last:border-0 hover:bg-black/[.03]">
            <div className="min-w-0">
              <div className="font-semibold truncate">{t.leagueName}</div>
              <div className="muted text-xs truncate">{t.teamName} · {t.numTeams} teams</div>
            </div>
            <div className="text-right text-sm shrink-0">
              <b>{t.wins}-{t.losses}{t.ties ? `-${t.ties}` : ""}</b>
              {t.rank && <span className="muted"> · {ordinal(t.rank)}</span>}
              <div className="muted text-xs">{t.pointsFor.toFixed(0)} pts</div>
            </div>
          </Link>
        ))}
        {!loadError && teams.length === 0 && <p className="p-4 text-sm">No Yahoo football leagues found this season.</p>}
      </div>
    </div>
  );
}
