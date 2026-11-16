import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getNflState, getPlayers, record, rankOf, ordinal, points, formatTags } from "@/lib/sleeper";
import { ESPN_COOKIE, parseCreds, getEspnLeague } from "@/lib/espn";

async function save(formData: FormData) {
  "use server";
  const jar = await cookies();
  const old = parseCreds(jar.get(ESPN_COOKIE)?.value);
  const ids = String(formData.get("ids") ?? "").split(/[\s,]+/).map((x) => x.replace(/\D/g, "")).filter(Boolean);
  // Accept the codes with or without the "espn_s2=" / "SWID=" labels people often copy along.
  const tidy = (v: FormDataEntryValue | null, label: string) => String(v ?? "").trim().replace(new RegExp(`^${label}=`, "i"), "").replace(/;$/, "").trim();
  let s2 = tidy(formData.get("s2"), "espn_s2"), swid = tidy(formData.get("swid"), "SWID");
  if (s2.includes("%")) { try { s2 = decodeURIComponent(s2); } catch { /* keep as typed */ } }
  if (swid && !swid.startsWith("{")) swid = `{${swid}}`;
  const creds = { s2: s2 || old?.s2 || "", swid: swid || old?.swid || "", ids: ids.length ? ids : old?.ids ?? [] };
  if (!creds.ids.length) redirect("/espn?error=ids");
  jar.set(ESPN_COOKIE, JSON.stringify(creds), {
    httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 365,
  });
  redirect("/espn");
}

async function disconnect() {
  "use server";
  (await cookies()).delete(ESPN_COOKIE);
  redirect("/espn");
}

function Form({ ids, has }: { ids?: string; has: boolean }) {
  const input = "mt-1 w-full rounded-[10px] border line px-3 py-2 bg-transparent text-sm";
  return (
    <form action={save} className="mt-3">
      <label className="block text-sm font-semibold">League IDs
        <input name="ids" defaultValue={ids} placeholder="e.g. 123456, 987654" className={input} />
      </label>
      <p className="text-[11px] muted mt-1">The number after leagueId= in your league&apos;s web address. Separate several with commas.</p>
      <label className="block text-sm font-semibold mt-3">espn_s2
        <input name="s2" type="password" autoComplete="off" placeholder={has ? "Saved. Leave blank to keep it." : "Paste the long code"} className={input} />
      </label>
      <label className="block text-sm font-semibold mt-3">SWID
        <input name="swid" type="password" autoComplete="off" placeholder={has ? "Saved. Leave blank to keep it." : "{XXXXXXXX-XXXX-...}"} className={input} />
      </label>
      <p className="text-[11px] muted mt-1">Both codes are cookies from fantasy.espn.com while you&apos;re logged in. They stay in this browser only and are sent just to ESPN.</p>
      <button className="btn mt-4">Save</button>
    </form>
  );
}

export default async function EspnPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  const creds = parseCreds((await cookies()).get(ESPN_COOKIE)?.value);
  if (!creds) {
    return (
      <div className="max-w-md mx-auto card p-6">
        <h1 className="text-xl font-bold">Connect ESPN</h1>
        <p className="muted text-sm mt-1">ESPN has no sign-in for outside sites, so this uses your league IDs and two codes from your ESPN login.</p>
        {error && <p className="text-sm text-red-500 mt-2">Enter at least one league ID.</p>}
        <Form has={false} />
      </div>
    );
  }
  const [state, players] = await Promise.all([getNflState(), getPlayers()]);
  const results = await Promise.all(creds.ids.map((id) => getEspnLeague(id, state.season, creds, players)));
  return (
    <div>
      <h1 className="text-xl font-bold">ESPN leagues</h1>
      <div className="card mt-3 divide-y line">
        {results.map((r) => r.ok ? (
          <Link key={r.league.league_id} href={`/espn/league/${r.league.league_id}`} className="flex flex-wrap items-baseline justify-between gap-x-4 px-4 py-3">
            <span><b>{r.league.name}</b> <span className="muted text-xs">{r.team ? `${r.team} · ` : ""}{formatTags(r.league).join(" · ")}</span></span>
            {r.mine
              ? <span className="text-sm"><b>{record(r.mine)}</b> <span className="muted">· {ordinal(rankOf(r.rosters, r.mine))} of {r.rosters.length} · {points(r.mine).toFixed(1)} pts</span></span>
              : <span className="text-sm text-red-500">Couldn&apos;t find your team. Check the SWID code.</span>}
          </Link>
        ) : (
          <div key={r.id} className="px-4 py-3 text-sm"><b>League {r.id}</b> <span className="text-red-500">{r.error}</span></div>
        ))}
      </div>
      <details className="card px-4 py-3 mt-3">
        <summary className="cursor-pointer text-sm font-semibold">Change leagues or paste fresh codes</summary>
        <Form ids={creds.ids.join(", ")} has={!!creds.s2} />
        <form action={disconnect} className="mt-3"><button className="text-xs underline muted">Disconnect ESPN</button></form>
      </details>
    </div>
  );
}
