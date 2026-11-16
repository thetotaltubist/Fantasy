import { cookies } from "next/headers";
import { redirect } from "next/navigation";

export default async function Home({ searchParams }: { searchParams: Promise<{ change?: string }> }) {
  const { change } = await searchParams;
  const saved = (await cookies()).get("fhq_sleeper")?.value;
  if (saved && !change) redirect(`/sleeper/${encodeURIComponent(saved)}`);

  return (
    <div className="max-w-md mx-auto pt-8">
      <h1 className="text-2xl font-bold tracking-tight">Connect your leagues</h1>
      <p className="muted text-sm mt-1">You only need to do this once on each device.</p>
      <form action="/go" method="get" className="card mt-5 p-5">
        <label htmlFor="u" className="font-semibold text-sm">Sleeper username</label>
        <div className="mt-2 flex gap-2">
          <input id="u" name="u" required defaultValue={saved ?? ""} placeholder="e.g. jdicesar"
            className="flex-1 rounded-[10px] border line px-3 py-2 bg-transparent" />
          <button className="btn">Connect</button>
        </div>
      </form>
      <div className="mt-3 grid grid-cols-2 gap-2 text-xs muted text-center">
        <div className="card p-3">ESPN: coming soon</div>
        <div className="card p-3">Yahoo: waiting on Yahoo approval</div>
      </div>
    </div>
  );
}
