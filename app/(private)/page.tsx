export default function Home() {
  return (
    <div className="max-w-xl mx-auto text-center pt-10">
      <h1 className="text-3xl font-bold tracking-tight">All your fantasy leagues in one place</h1>
      <p className="muted mt-3">
        Connect your leagues to see your rosters. Start-sit picks, waiver adds and trade ideas come next.
      </p>
      <form action="/sleeper" method="get" className="card mt-8 p-5 text-left">
        <label htmlFor="u" className="font-semibold">Sleeper username</label>
        <p className="muted text-sm mt-1">No password needed. Sleeper shares league data publicly.</p>
        <div className="mt-3 flex gap-2">
          <input id="u" name="u" required placeholder="e.g. johnfantasy"
            className="flex-1 rounded-[10px] border line px-3 py-2 bg-transparent" />
          <button className="btn">Connect</button>
        </div>
      </form>
      <div className="mt-4 grid grid-cols-2 gap-3 text-sm muted">
        <div className="card p-4">ESPN: coming soon</div>
        <div className="card p-4">Yahoo: coming soon</div>
      </div>
    </div>
  );
}
