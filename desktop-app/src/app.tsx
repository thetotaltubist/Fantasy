// Fantasy HQ as a Mac app: the website's pages, rebuilt to run inside an installed Claude artifact.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { setDesktop, ENV, clearCache, siteToken, checkSite, SITE_KEY } from "./net";
import { loadAll, summarize, buildLeague, type Settings, type Loaded, type Summary, type LeagueModel } from "./data";
import { record, points, rankOf, ordinal, slotLabel, formatTags, isBad, getNflState, playerName, type Player } from "@/lib/sleeper";
import { discoverLeagues, type EspnCreds } from "@/lib/espn";
import { expertSource } from "@/lib/experts";
import { MIN_EXPERTS } from "@/lib/fantasypros";
import { LAST_WEEK } from "@/lib/matchups";
import { positionOf, type Proj } from "@/lib/projections";
import { dynastyNote, fmtValue } from "@/lib/dynasty";

declare const React: any;
declare const ReactDOM: any;
const { useState, useEffect, useCallback } = React;

// ---------- Settings, kept in this app's own storage ----------
const KEY = "fhq-settings";
const EMPTY: Settings = { sleeper: "", espn: null, fpKey: "", oddsKey: "" };
function readSettings(): Settings {
  try { return { ...EMPTY, ...JSON.parse(localStorage.getItem(KEY) ?? "{}") }; } catch { return EMPTY; }
}
function writeSettings(s: Settings) {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* storage blocked */ }
}
function applyEnv(s: Settings) {
  // Own keys win; otherwise, with the website password, the site's keys are used.
  ENV.SITE_TOKEN = s.siteToken || undefined;
  ENV.FANTASYPROS_API_KEY = s.fpKey || (s.siteToken ? SITE_KEY : undefined);
  ENV.ODDS_API_KEY = s.oddsKey || (s.siteToken ? SITE_KEY : undefined);
}

const go = (h: string) => { location.hash = h; };
const POS_COLOR: Record<string, string> = { QB: "#ef4444", RB: "#22c55e", WR: "#3b82f6", TE: "#f59e0b", K: "#a855f7", DEF: "#64748b" };

// ---------- Small pieces ----------
function PosBadge({ pos }: { pos: string }) {
  return <span className="w-8 shrink-0 text-center text-[10px] font-bold py-0.5 rounded text-white" style={{ background: POS_COLOR[pos] ?? "#94a3b8" }}>{pos}</span>;
}
function Stat({ label, value, alert }: { label: string; value: string; alert?: boolean }) {
  return (
    <div className="card py-2.5">
      <div className={`text-lg font-bold tabular-nums ${alert ? "text-red-500" : ""}`}>{value}</div>
      <div className="muted text-xs">{label}</div>
    </div>
  );
}
function Loading({ what }: { what: string }) {
  return (
    <div className="card px-4 py-6 mt-4 text-sm flex items-center gap-3">
      <span className="spinner" aria-hidden="true"></span>
      <span>{what}</span>
    </div>
  );
}
function Problem({ children }: { children: any }) {
  return <p className="mt-3 text-sm rounded-lg px-3 py-2 bg-red-500/10 text-red-500 font-semibold">{children}</p>;
}

// ---------- All leagues ----------
function LeaguesScreen({ data, rows, onRefresh }: { data: Loaded; rows: Summary[] | null; onRefresh: () => void }) {
  const { state } = data;
  const list = rows ?? [];
  const needFix = list.filter((r) => r.out.length || r.empty || r.gain >= 1).length;
  const dupes = new Set(list.map((r) => r.l.name).filter((n, i, a) => a.indexOf(n) !== i));
  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <p className="muted text-xs uppercase tracking-wide">{[...new Set(data.entries.map((r) => r.site))].join(" + ") || "No leagues"} · Week {state.week}</p>
          <h1 className="text-xl font-bold">My leagues</h1>
        </div>
        <span className="muted text-xs flex gap-3">
          {data.sleeperName && <a href="#settings" className="underline">Sleeper: {data.sleeperName}</a>}
          <a href="#espn" className={`underline ${data.espnFailed.length ? "text-red-500 font-semibold" : ""}`}>
            {data.espnFailed.length ? `${data.espnFailed.length} ESPN league${data.espnFailed.length > 1 ? "s" : ""} need attention` : "ESPN settings"}
          </a>
          <button className="underline" onClick={onRefresh}>Refresh</button>
        </span>
      </div>
      {data.sleeperError && <Problem>{data.sleeperError} <a className="underline" href="#settings">Change it</a></Problem>}

      <div className="grid grid-cols-3 gap-2 mt-4 text-center">
        <Stat label="Leagues" value={String(data.entries.length)} />
        <Stat label="Overall record" value={`${data.entries.reduce((s, e) => s + e.mine.settings.wins, 0)}-${data.entries.reduce((s, e) => s + e.mine.settings.losses, 0)}`} />
        <Stat label="Lineups to improve" value={rows ? String(needFix) : "…"} alert={needFix > 0} />
      </div>

      <div className="card mt-4 overflow-hidden">
        <div className="hidden sm:grid grid-cols-[1fr_5rem_5rem_5rem_9rem] gap-2 px-4 py-2 text-xs muted border-b line">
          <span>League</span><span className="text-right">Record</span><span className="text-right">Rank</span>
          <span className="text-right">Proj.</span><span className="text-right">Start-sit</span>
        </div>
        {data.entries.map((en) => {
          const r = list.find((x) => x.key === en.key);
          const rank = rankOf(en.rosters, en.mine);
          return (
            <a key={en.key} href={`#league-${en.key}`}
              className="grid grid-cols-[1fr_auto] sm:grid-cols-[1fr_5rem_5rem_5rem_9rem] gap-x-2 gap-y-1 items-center px-4 py-2.5 border-b line last:border-0 rowlink">
              <div className="min-w-0">
                <div className="font-semibold truncate">
                  {en.l.name}{dupes.has(en.l.name) && en.team ? <span className="muted font-normal"> · {en.team}</span> : null}
                </div>
                <div className="muted text-xs truncate">
                  <span className="font-semibold" style={{ color: en.site === "ESPN" ? "var(--espn)" : "var(--sleeper)" }}>{en.site}</span> · {en.rosters.length} teams · {formatTags(en.l).join(" · ")}
                </div>
              </div>
              <div className="text-right sm:hidden text-sm"><b>{record(en.mine)}</b> <span className="muted">· {ordinal(rank)}</span></div>
              <span className="hidden sm:block text-right font-semibold tabular-nums">{record(en.mine)}</span>
              <span className="hidden sm:block text-right tabular-nums">{ordinal(rank)}<span className="muted text-xs">/{en.rosters.length}</span></span>
              <span className="hidden sm:block text-right tabular-nums muted">{r ? r.proj.toFixed(1) : "…"}</span>
              <span className="col-span-2 sm:col-span-1 sm:text-right text-xs">
                {!r ? <span className="muted">Working it out…</span>
                  : r.gain >= 1 ? (
                    <span className="font-semibold text-red-500" title={r.out.join(", ")}>+{r.gain.toFixed(1)} pts available{r.out.length ? ` · ${r.out.length} hurt` : ""}</span>
                  ) : r.out.length || r.empty ? (
                    <span className="font-semibold text-red-500" title={r.out.join(", ")}>{r.out.length ? `${r.out.length} injured starter${r.out.length > 1 ? "s" : ""}` : `${r.empty} empty`}</span>
                  ) : r.q ? <span className="text-amber-500 font-semibold">Best lineup · {r.q} Q</span>
                  : <span style={{ color: "var(--brand)" }} className="font-semibold">Best lineup</span>}
              </span>
            </a>
          );
        })}
        {data.entries.length === 0 && (
          <p className="p-5 text-sm">No {state.season} leagues found. Add your Sleeper username in <a className="underline" href="#settings">Settings</a> or connect <a className="underline" href="#espn">ESPN</a>.</p>
        )}
      </div>
    </div>
  );
}

// ---------- One league ----------
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
      <PosBadge pos={pos} />
      <span className="font-medium truncate">{playerName(p, id)}</span>
      <span className="muted text-xs shrink-0">
        {p?.team ?? ""}{proj?.opponent ? ` v ${proj.opponent}` : ""}
        {pts !== undefined && !proj?.opponent && !played && <span className="font-semibold text-amber-500"> BYE</span>}
      </span>
      {p?.injury_status && <span className={`shrink-0 text-[11px] font-semibold ${bad ? "text-red-500" : "text-amber-500"}`}>{p.injury_status === "Questionable" ? "Q" : p.injury_status}</span>}
      {played ? <span className="ml-auto shrink-0 text-[11px] muted">played</span>
        : pts !== undefined && (
          <span className="ml-auto shrink-0 tabular-nums text-sm font-semibold">
            {vegas !== undefined && Math.abs(vegas) >= 0.3 && (
              <span className={`text-[10px] font-normal mr-1 ${vegas > 0 ? "text-green-500" : "text-red-500"}`} title="Vegas adjustment">{vegas > 0 ? "▲" : "▼"}{Math.abs(vegas).toFixed(1)}</span>
            )}
            {pts.toFixed(1)}
          </span>
        )}
    </li>
  );
}
function Group({ title, ids, players }: { title: string; ids: string[]; players: Record<string, Player> }) {
  if (ids.length === 0) return null;
  return (
    <details className="mt-3 group">
      <summary className="cursor-pointer text-sm font-semibold select-none list-none flex items-center gap-1">
        <span className="muted text-xs group-open:rotate-90 transition-transform">▶</span> {title}
        <span className="muted font-normal">({ids.length})</span>
      </summary>
      <ul className="mt-1">{ids.map((id) => <Row key={id} id={id} p={players[id]} />)}</ul>
    </details>
  );
}
// "dynasty 3,482 · age 23"
const dynLabel = (v?: number, age?: number | null) =>
  `dynasty ${fmtValue(v ?? 0)}${age ? ` · age ${Math.floor(age)}` : ""}`;

const pct = (f: number) => { const n = Math.round((f - 1) * 100); return `${n > 0 ? "+" : n < 0 ? "−" : ""}${Math.abs(n)}%`; };
const tone = (f: number) => (f >= 1.05 ? "var(--good)" : f <= 0.95 ? "var(--bad)" : "inherit");
function Chip({ opp, factor }: { opp: string | null; factor: number | null }) {
  if (!opp || factor == null) return <td className="px-1 text-xs muted whitespace-nowrap">BYE</td>;
  return <td className="px-1 text-xs whitespace-nowrap tabular-nums"><span className="muted">{opp}</span> <span style={{ color: tone(factor) }}>{pct(factor)}</span></td>;
}

function LeagueNav({ data, active }: { data: Loaded; active: string }) {
  return (
    <nav className="chips flex gap-1.5 overflow-x-auto pb-2 text-xs">
      <a href="#leagues" className="shrink-0 rounded-full border line px-3 py-1 muted">All</a>
      {data.entries.map((e) => (
        <a key={e.key} href={`#league-${e.key}`}
          className={`shrink-0 rounded-full border px-3 py-1 whitespace-nowrap ${e.key === active ? "font-semibold chip-on" : "line"}`}>
          {e.l.name.trim()}
        </a>
      ))}
    </nav>
  );
}

function LeagueScreen({ m, setWeek }: { m: LeagueModel; setWeek: (w: number) => void }) {
  const { league, rosters, players, mine, team, state, week, slots, starters, reserve, taxi, bench, problems, projections,
    projError, propped, pts, vegas, weekly, weeklyUsed, hasLines, matchups, playoffWeeks, nextWeeks, sched, picks, trades, dynasty,
    ownerName, bestBall, locked, allLocked, advice, name } = m;
  const site = m.en.site;
  return (
    <div>
      <div className="mt-3 flex flex-wrap items-baseline justify-between gap-x-4">
        <h1 className="text-xl font-bold">{league.name}</h1>
        <p className="text-sm"><b>{record(mine)}</b> <span className="muted">· {ordinal(rankOf(rosters, mine))} of {rosters.length} · {points(mine).toFixed(1)} pts</span></p>
      </div>
      <p className="muted text-xs">{team ? `${team} · ` : ""}{formatTags(league).join(" · ")}</p>
      {problems > 0 && <Problem>{problems} starter{problems > 1 ? "s" : ""} injured or empty. Check your lineup in {site}.</Problem>}

      <section className="card px-4 py-3 mt-3">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4">
          <h2 className="text-sm font-semibold">Start-sit for Week {week}</h2>
          <p className="text-xs muted">
            {week === state.week
              ? <button className="underline" onClick={() => setWeek(Math.min(18, state.week + 1))}>Look ahead to Week {Math.min(18, state.week + 1)}</button>
              : <button className="underline" onClick={() => setWeek(state.week)}>Back to Week {state.week}</button>}
          </p>
        </div>
        {projError ? <p className="text-sm muted mt-1">Projections aren&apos;t available right now.</p>
          : bestBall ? <p className="text-sm muted mt-1">Best ball league: your lineup sets itself. Projected {advice.best.toFixed(1)} pts.</p>
          : allLocked ? <p className="text-sm muted mt-1">All your starters have played, so this week&apos;s lineup is locked. Look ahead to next week.</p>
          : advice.swaps.filter((w) => w.gain >= 0.5).length === 0 ? (
            <p className="text-sm mt-1"><b style={{ color: "var(--brand)" }}>Your lineup is the best one available.</b> <span className="muted">Projected {advice.current.toFixed(1)} pts.</span></p>
          ) : (
            <>
              <p className="text-sm mt-1">Projected <b>{advice.current.toFixed(1)}</b> pts now, <b>{advice.best.toFixed(1)}</b> with these changes <b style={{ color: "var(--brand)" }}>(+{advice.gain.toFixed(1)})</b></p>
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
          {propped > 0 ? `Player prop lines (yards, catches, touchdown odds) adjust ${propped} players this week. ` : ""}
          {weeklyUsed ? `Then blended half and half with the FantasyPros weekly consensus (${weekly.top20 === "all" ? "the 20 most accurate experts at each position" : weekly.top20 === "some" ? "the 20 most accurate experts where enough have posted, everyone elsewhere" : `all ${weekly.experts} experts who have posted, since the top 20 haven't yet`}, updated ${weekly.updated}).`
            : weekly.experts > 0 ? `Only ${weekly.experts} FantasyPros experts have ranked this week so far, so their consensus joins in once at least ${MIN_EXPERTS} have.`
            : "FantasyPros weekly rankings aren't loaded (add your website password in Settings)."}</p>
      </section>

      <section className="card px-4 py-3 mt-3">
        <h2 className="text-sm font-semibold">Waiver targets</h2>
        {picks.length === 0 ? <p className="text-sm muted mt-1">Nothing on the wire clearly beats what you have.</p> : (
          <ul className="mt-1">
            {picks.map((w) => (
              <li key={w.addId} className="flex flex-wrap items-baseline gap-x-2 py-1.5 border-t line first:border-0 text-sm">
                <PosBadge pos={w.pos} />
                <span><b>Add</b> {name(w.addId)} <span className="muted text-xs">{players[w.addId]?.team ?? ""} · {w.unit === "value" ? dynLabel(w.addDyn, w.addAge) : `${w.addAvg.toFixed(1)}/gm`}{w.addRank ? ` · ROS ${w.pos}${w.addRank}` : ""}</span></span>
                {w.trending && <span className="text-[10px] font-semibold text-amber-500">HOT</span>}
                {w.dropId && <span><b>Drop</b> {name(w.dropId)} <span className="muted text-xs">{w.unit === "value" ? dynLabel(w.dropDyn, w.dropAge) : `${w.dropAvg.toFixed(1)}/gm`}{w.dropRank ? ` · ROS ${w.pos}${w.dropRank}` : ""}</span></span>}
                <span className="ml-auto font-semibold tabular-nums" style={{ color: "var(--brand)" }}>+{w.unit === "value" ? fmtValue(w.gain) : w.gain.toFixed(1)}</span>
              </li>
            ))}
          </ul>
        )}
        <p className="text-[11px] muted mt-2">Value blends projected points over the next three weeks with {expertSource.count ? expertSource.label : "expert rankings once uploaded"}. HOT means lots of Sleeper managers added the player in the last day.
          {dynasty ? ` ${dynastyNote(dynasty)} The green number is the gain in that blended value.`
            : league.settings?.type === 2 ? " Dynasty values couldn't be loaded, so this only looks at the next few weeks. Weigh long-term value before dropping young players." : ""}</p>
      </section>

      <section className="card px-4 py-3 mt-3">
        <h2 className="text-sm font-semibold">Trade partners</h2>
        {trades.length === 0 ? <p className="text-sm muted mt-1">No one-for-one trade clearly helps both teams right now.</p> : (
          <ul className="mt-1">
            {trades.map((t) => {
              const gp = positionOf(t.giveId, players[t.giveId]), rp = positionOf(t.getId, players[t.getId]);
              return (
                <li key={t.partnerId} className="py-1.5 border-t line first:border-0 text-sm">
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    <span className="font-semibold">{ownerName(t.partnerId)}</span>
                    <span className="ml-auto font-semibold tabular-nums" style={{ color: "var(--brand)" }}>+{t.unit === "value" ? fmtValue(t.myGain) : t.myGain.toFixed(1)}</span>
                  </div>
                  <div className="flex flex-wrap items-baseline gap-x-3">
                    <span><b>Get</b> {name(t.getId)} <span className="muted text-xs">{rp} · {t.unit === "value" ? dynLabel(t.getDyn, t.getAge) : `${t.getVal.toFixed(1)}/gm`}{t.getRank ? ` · ROS ${rp}${t.getRank}` : ""}</span>
                      {t.pick?.side === "get" && <> <b>+</b> their {t.pick.label} <span className="muted text-xs">{fmtValue(t.pick.value)}</span></>}</span>
                    <span><b>Give</b> {name(t.giveId)} <span className="muted text-xs">{gp} · {t.unit === "value" ? dynLabel(t.giveDyn, t.giveAge) : `${t.giveVal.toFixed(1)}/gm`}{t.giveRank ? ` · ROS ${gp}${t.giveRank}` : ""}</span>
                      {t.pick?.side === "give" && <> <b>+</b> your {t.pick.label} <span className="muted text-xs">{fmtValue(t.pick.value)}</span></>}</span>
                    <span className="muted text-xs">helps them +{t.unit === "value" ? fmtValue(t.theirGain) : t.theirGain.toFixed(1)}</span>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        <p className="text-[11px] muted mt-2">Each idea swaps a player you can spare for one who would start for you, where the other team&apos;s starting lineup improves too.{dynasty ? "" : " The green number is points per game added to your lineup."} Injured players are left out.
          {dynasty ? ` ${dynastyNote(dynasty)} Each team's lineup is scored with its own mix (rebuilding teams weigh the future more), offers must be within about 10% in dynasty value, and a rookie pick is added to the lighter side when needed. Rebuilding teams aren't offered players 28 or older. Green numbers are blended value, not points.`
            : league.settings?.type === 2 ? " Dynasty values couldn't be loaded, so this ignores age and draft picks." : ""}</p>
      </section>

      {sched.length > 0 && (
        <section className="card px-4 py-3 mt-3">
          <h2 className="text-sm font-semibold">Schedule ahead</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm mt-1">
              <thead>
                <tr className="text-[11px] muted text-left">
                  <th className="font-normal py-1">Player</th>
                  {nextWeeks.map((w) => <th key={w} className="font-normal px-1">Wk {w}</th>)}
                  {playoffWeeks.map((w) => <th key={w} className="font-semibold px-1">Wk {w}</th>)}
                  <th className="font-normal text-right">Playoffs</th>
                </tr>
              </thead>
              <tbody>
                {sched.map((r) => (
                  <tr key={r.id} className="border-t line">
                    <td className="py-1.5 pr-2 whitespace-nowrap">{name(r.id)} <span className="muted text-xs">{positionOf(r.id, players[r.id])}</span></td>
                    {[...r.next, ...r.po.list].map((g) => <Chip key={g.week} opp={g.opp} factor={g.factor} />)}
                    <td className="text-right font-semibold tabular-nums" style={{ color: tone(r.po.avg) }}>{pct(r.po.avg)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-[11px] muted mt-2">Each number is how many more or fewer fantasy points that defense has allowed to the position than those same players usually score, over {matchups!.weeksUsed} weeks this season. Green is a soft matchup, red is a tough one. Playoffs is the average for weeks {playoffWeeks[0]} to {LAST_WEEK}, and it nudges waiver and trade values a little.</p>
        </section>
      )}

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

function LeagueLoader({ data, entryKey }: { data: Loaded; entryKey: string }) {
  const en = data.entries.find((e) => e.key === entryKey);
  const [week, setWeek] = useState(data.state.week);
  const [m, setM] = useState(null as LeagueModel | null);
  const [err, setErr] = useState("");
  useEffect(() => { setWeek(data.state.week); }, [entryKey]);
  useEffect(() => {
    if (!en) return;
    let live = true;
    setM(null); setErr("");
    buildLeague(en, data.state, week).then((x) => { if (live) setM(x); }).catch((e) => { if (live) setErr(String(e?.message ?? e)); });
    return () => { live = false; };
  }, [entryKey, week, data]);
  if (!en) return <div><LeagueNav data={data} active="" /><Problem>That league isn&apos;t in your list any more.</Problem></div>;
  return (
    <div>
      <LeagueNav data={data} active={entryKey} />
      {err ? <Problem>Couldn&apos;t work out this league: {err}</Problem>
        : m ? <LeagueScreen m={m} setWeek={setWeek} />
        : <Loading what={`Working out start-sit, waivers and trades for ${en.l.name}…`} />}
    </div>
  );
}

// ---------- Settings ----------
const input = "mt-1 w-full rounded-[10px] border line px-3 py-2 field text-sm";
function SettingsScreen({ s, onSave }: { s: Settings; onSave: (s: Settings) => void }) {
  const [u, setU] = useState(s.sleeper);
  const [pw, setPw] = useState("");
  const [fp, setFp] = useState("");
  const [odds, setOdds] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async (e: any) => {
    e.preventDefault();
    setBusy(true); setNote("");
    let token = s.siteToken;
    let msg = "Saved.";
    if (pw) {
      const t = await siteToken(pw);
      const r = await checkSite(t);
      msg = r.note;
      if (r.ok) token = t;
    }
    onSave({ ...s, sleeper: u.trim(), siteToken: token, fpKey: fp.trim() || s.fpKey, oddsKey: odds.trim() || s.oddsKey });
    setPw(""); setFp(""); setOdds(""); setNote(msg); setBusy(false);
  };
  return (
    <div className="max-w-md mx-auto">
      <h1 className="text-xl font-bold">Settings</h1>
      <p className="muted text-sm mt-1">Everything here stays inside this app on this Mac.</p>
      <form onSubmit={submit} className="card p-5 mt-4">
        <label htmlFor="sleeper-user" className="block text-sm font-semibold">Sleeper username</label>
        <input id="sleeper-user" value={u} onChange={(e: any) => setU(e.target.value)} placeholder="e.g. jdicesar" className={input} autoComplete="off" />
        <label htmlFor="site-pw" className="block text-sm font-semibold mt-4">Fantasy HQ website password</label>
        <input id="site-pw" type="password" value={pw} onChange={(e: any) => setPw(e.target.value)} placeholder={s.siteToken ? "Connected. Leave blank to keep it." : "The password you sign in to the website with"} className={input} autoComplete="off" />
        <p className="text-[11px] muted mt-1">With it, the app gets FantasyPros rankings, Vegas lines and player props through your website, using the keys already saved there. The keys never come to this app.</p>
        <details className="mt-3">
          <summary className="text-xs muted cursor-pointer">Use my own API keys instead</summary>
          <label htmlFor="fp-key" className="block text-sm font-semibold mt-3">FantasyPros API key</label>
          <input id="fp-key" type="password" value={fp} onChange={(e: any) => setFp(e.target.value)} placeholder={s.fpKey ? "Saved. Leave blank to keep it." : "Optional"} className={input} autoComplete="off" />
          <label htmlFor="odds-key" className="block text-sm font-semibold mt-3">The Odds API key</label>
          <input id="odds-key" type="password" value={odds} onChange={(e: any) => setOdds(e.target.value)} placeholder={s.oddsKey ? "Saved. Leave blank to keep it." : "Optional"} className={input} autoComplete="off" />
        </details>
        <p className="text-[11px] muted mt-2">Betting lines are kept for a few hours so opening the app doesn&apos;t use up Odds API credits.</p>
        <div className="flex items-center gap-3 mt-4">
          <button className="btn" disabled={busy}>{busy ? "Checking…" : "Save"}</button>
          {note && <span className="text-sm">{note}</span>}
        </div>
      </form>
      <div className="card p-4 mt-3 text-sm flex flex-wrap items-center justify-between gap-2">
        <span>ESPN {s.espn ? `connected · ${s.espn.ids.length} league${s.espn.ids.length === 1 ? "" : "s"}` : "not connected"}</span>
        <a className="underline" href="#espn">{s.espn ? "ESPN settings" : "Connect ESPN"}</a>
      </div>
      {(s.siteToken || s.fpKey || s.oddsKey) && (
        <div className="mt-3 text-xs muted flex flex-wrap gap-4">
          {s.siteToken && <button className="underline" onClick={() => onSave({ ...s, siteToken: "" })}>Disconnect the website</button>}
          {s.fpKey && <button className="underline" onClick={() => onSave({ ...s, fpKey: "" })}>Remove FantasyPros key</button>}
          {s.oddsKey && <button className="underline" onClick={() => onSave({ ...s, oddsKey: "" })}>Remove Odds API key</button>}
        </div>
      )}
    </div>
  );
}

// ---------- ESPN ----------
function EspnScreen({ s, data, onSave }: { s: Settings; data: Loaded | null; onSave: (s: Settings) => void }) {
  const [s2, setS2] = useState("");
  const [swid, setSwid] = useState("");
  const [ids, setIds] = useState((s.espn?.ids ?? []).join(", "));
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const has = !!s.espn?.s2;
  const tidy = (v: string, label: string) => v.trim().replace(new RegExp(`^${label}=`, "i"), "").replace(/;$/, "").trim();
  const submit = async (e: any) => {
    e.preventDefault();
    setBusy(true); setNote("");
    const old = s.espn;
    let a = tidy(s2, "espn_s2").replace(/\s+/g, ""), b = tidy(swid, "SWID");
    if (b && !b.startsWith("{")) b = `{${b}}`;
    const typed = ids.split(/[\s,]+/).map((x: string) => x.replace(/\D/g, "")).filter(Boolean);
    const creds: EspnCreds = { s2: a || old?.s2 || "", swid: b || old?.swid || "", ids: typed.length ? typed : old?.ids ?? [] };
    try {
      const found = await discoverLeagues(creds.s2, creds.swid, (await getNflState()).season);
      creds.ids = [...new Set([...creds.ids, ...found.ids])];
      setNote(found.note);
    } catch (err: any) { setNote(`Couldn't reach ESPN (${String(err?.message ?? err).slice(0, 80)}).`); }
    setBusy(false);
    if (!creds.s2 && !creds.ids.length) { setNote("Paste both codes."); return; }
    setS2(""); setSwid(""); setIds(creds.ids.join(", "));
    onSave({ ...s, espn: creds });
  };
  const espnEntries = data?.entries.filter((e) => e.site === "ESPN") ?? [];
  return (
    <div className="max-w-xl mx-auto">
      <h1 className="text-xl font-bold">{has ? "ESPN leagues" : "Connect ESPN"}</h1>
      <p className="muted text-sm mt-1">ESPN has no sign-in for outside apps, so this uses two codes from your ESPN login to find your leagues.</p>
      {has && (
        <div className="card mt-3">
          {espnEntries.map((en) => (
            <a key={en.key} href={`#league-${en.key}`} className="flex flex-wrap items-baseline justify-between gap-x-4 px-4 py-3 border-b line last:border-0 rowlink">
              <span><b>{en.l.name}</b> <span className="muted text-xs">{en.team ? `${en.team} · ` : ""}{formatTags(en.l).join(" · ")}</span></span>
              <span className="text-sm"><b>{record(en.mine)}</b> <span className="muted">· {ordinal(rankOf(en.rosters, en.mine))} of {en.rosters.length} · {points(en.mine).toFixed(1)} pts</span></span>
            </a>
          ))}
          {data?.espnFailed.map((f) => <div key={f.id} className="px-4 py-3 text-sm border-b line last:border-0"><b>League {f.id}</b> <span className="text-red-500">{f.error}</span></div>)}
          {!data && <p className="px-4 py-3 text-sm muted">Loading…</p>}
          {data && espnEntries.length === 0 && data.espnFailed.length === 0 && <p className="px-4 py-3 text-sm">Your codes are saved, but no leagues were found yet.</p>}
        </div>
      )}
      <form onSubmit={submit} className="card p-5 mt-3">
        <label htmlFor="espn-s2" className="block text-sm font-semibold">espn_s2</label>
        <input id="espn-s2" type="password" value={s2} onChange={(e: any) => setS2(e.target.value)} autoComplete="off" placeholder={has ? "Saved. Leave blank to keep it." : "Paste the long code"} className={input} />
        <label htmlFor="espn-swid" className="block text-sm font-semibold mt-3">SWID</label>
        <input id="espn-swid" type="password" value={swid} onChange={(e: any) => setSwid(e.target.value)} autoComplete="off" placeholder={has ? "Saved. Leave blank to keep it." : "{XXXXXXXX-XXXX-...}"} className={input} />
        <p className="text-[11px] muted mt-1">Both codes are cookies from fantasy.espn.com while you&apos;re logged in. They stay in this app and are sent only to ESPN.</p>
        <label htmlFor="espn-ids" className="block text-sm font-semibold mt-3">League IDs <span className="muted font-normal">(optional)</span></label>
        <input id="espn-ids" value={ids} onChange={(e: any) => setIds(e.target.value)} placeholder="Leave blank to find all your leagues" className={input} />
        <p className="text-[11px] muted mt-1">Your leagues are found from the two codes. Only add an ID if one is missing: it&apos;s the number after leagueId= in the league&apos;s web address.</p>
        <button className="btn mt-4" disabled={busy}>{busy ? "Checking with ESPN…" : "Save"}</button>
        {note && <p className="text-xs mt-3">{note}</p>}
      </form>
      {has && <button className="text-xs underline muted mt-3" onClick={() => onSave({ ...s, espn: null })}>Disconnect ESPN</button>}
    </div>
  );
}

// ---------- Before the app has what it needs ----------
function Gate({ desktop }: { desktop: any }) {
  const [installState, setInstallState] = useState("checking");
  const [msg, setMsg] = useState("");
  useEffect(() => {
    if (!desktop?.install) { setInstallState("unavailable"); return; }
    desktop.install.state().then(setInstallState).catch(() => setInstallState("unavailable"));
  }, []);
  const install = () => {
    desktop.install.request().then((r: string) => {
      if (r === "installed") setMsg("Installing. Open Fantasy HQ from your Applications or the Dock when it finishes.");
      else if (r === "cancelled") setMsg("Not installed.");
      else setMsg("Claude couldn't install it here.");
    }).catch((e: any) => setMsg(String(e?.message ?? e)));
  };
  return (
    <div className="max-w-xl mx-auto pt-4">
      <p className="muted text-xs uppercase tracking-wide">Fantasy HQ for Mac</p>
      <h1 className="text-2xl font-bold mt-1">Your leagues, start-sit, waivers and trades in one app</h1>
      <p className="text-sm mt-2">This is the Fantasy HQ website rebuilt as a Mac app. It reads your Sleeper and ESPN leagues and gives the same advice, but it runs from its own icon in your Dock instead of a browser tab.</p>
      <div className="card p-5 mt-4">
        {installState === "available" ? (
          <>
            <button className="btn" onClick={install}>Install as app</button>
            <p className="text-xs muted mt-2">Claude asks you to confirm first. After that, open Fantasy HQ like any other app.</p>
          </>
        ) : installState === "installed" ? (
          <p className="text-sm"><b>Installed on this Mac.</b> Open Fantasy HQ from the Dock or your Applications to see your leagues.</p>
        ) : installState === "checking" ? (
          <p className="text-sm muted">Checking…</p>
        ) : (
          <p className="text-sm">Open this page in the Claude desktop app on your Mac and choose <b>Install as app</b> from its menu. Your leagues load only inside the installed app.</p>
        )}
        {msg && <p className="text-sm mt-2">{msg}</p>}
      </div>
      <h2 className="text-sm font-semibold mt-6">What the app shows</h2>
      <ul className="text-sm mt-2 grid gap-2 sm:grid-cols-2">
        <li className="card px-4 py-3"><b>All your leagues</b><br /><span className="muted">Sleeper and ESPN together, with record, rank and which lineups can improve.</span></li>
        <li className="card px-4 py-3"><b>Start-sit</b><br /><span className="muted">Sleeper projections scored with each league&apos;s rules, adjusted by Vegas lines, props and expert ranks.</span></li>
        <li className="card px-4 py-3"><b>Waiver targets</b><br /><span className="muted">Who to add and who to drop over the next three weeks.</span></li>
        <li className="card px-4 py-3"><b>Trade partners and schedule</b><br /><span className="muted">Swaps that help both teams, and matchups through the fantasy playoffs.</span></li>
      </ul>
    </div>
  );
}

function AccessScreen({ desktop, state, onGranted }: { desktop: any; state: string; onGranted: () => void }) {
  const [msg, setMsg] = useState("");
  const ask = async () => {
    try {
      const r = await desktop.permissions.request(["full-access"]);
      if (r["full-access"] === "granted") onGranted(); else setMsg("Without this the app can't reach Sleeper or ESPN.");
    } catch (e: any) { setMsg(String(e?.message ?? e)); }
  };
  const manage = () => desktop.permissions.manage().then(async () => {
    if ((await desktop.permissions.state("full-access")) === "granted") onGranted();
  }).catch((e: any) => setMsg(String(e?.message ?? e)));
  return (
    <div className="max-w-md mx-auto card p-6 mt-4">
      <h1 className="text-xl font-bold">One step before your leagues load</h1>
      <p className="text-sm mt-2">Claude only lets an app reach other websites through your Mac. Fantasy HQ uses the Mac&apos;s built-in <code>curl</code> to read Sleeper, ESPN, FantasyPros and the betting lines. It runs nothing else, and it doesn&apos;t save files on your Mac.</p>
      <p className="text-sm mt-2 muted">Claude&apos;s permission box says the app could run programs and change files. That is the only way it grants network access.</p>
      {state === "denied" ? <button className="btn mt-4" onClick={manage}>Open permissions</button>
        : state === "unavailable" ? <p className="text-sm mt-4">Claude can&apos;t grant this right now. Quit and reopen the app, and make sure the Claude desktop app is signed in to your account.</p>
        : <button className="btn mt-4" onClick={ask}>Allow and load my leagues</button>}
      {msg && <p className="text-sm text-red-500 mt-2">{msg}</p>}
    </div>
  );
}

// ---------- The app ----------
function useHash() {
  const [h, setH] = useState(location.hash.slice(1));
  useEffect(() => { const f = () => setH(location.hash.slice(1)); addEventListener("hashchange", f); return () => removeEventListener("hashchange", f); }, []);
  return h;
}

function App({ desktop }: { desktop: any }) {
  const hash = useHash();
  const [access, setAccess] = useState("checking");
  const [settings, setSettings] = useState(readSettings);
  const [data, setData] = useState(null as Loaded | null);
  const [rows, setRows] = useState(null as Summary[] | null);
  const [err, setErr] = useState("");
  const [nonce, setNonce] = useState(0);
  const inApp = !!desktop?.childProcess;

  useEffect(() => {
    if (!inApp) return;
    desktop.permissions.state("full-access").then(setAccess).catch(() => setAccess("unavailable"));
  }, [inApp]);

  const ready = inApp && access === "granted";
  const configured = !!(settings.sleeper || settings.espn);
  useEffect(() => {
    if (!ready || !configured) return;
    let live = true;
    applyEnv(settings);
    setErr(""); setData(null); setRows(null);
    loadAll(settings).then((d) => {
      if (!live) return;
      setData(d);
      summarize(d).then((r) => { if (live) setRows(r); }).catch(() => { if (live) setRows([]); });
    }).catch((e) => { if (live) setErr(String(e?.message ?? e)); });
    return () => { live = false; };
  }, [ready, settings, nonce]);

  const save = useCallback((s: Settings) => { writeSettings(s); setSettings(s); }, []);
  const refresh = () => { clearCache(); location.reload(); };

  let body: any;
  if (!inApp) body = <Gate desktop={desktop} />;
  else if (access === "checking") body = <Loading what="Starting…" />;
  else if (access !== "granted") body = <AccessScreen desktop={desktop} state={access} onGranted={() => setAccess("granted")} />;
  else if (hash === "settings" || !configured && hash !== "espn") body = <SettingsScreen s={settings} onSave={(s) => { save(s); if (!configured && s.sleeper) go("leagues"); }} />;
  else if (hash === "espn") body = <EspnScreen s={settings} data={data} onSave={save} />;
  else if (err) body = <><Problem>Couldn&apos;t load your leagues: {err}</Problem><button className="btn mt-3" onClick={() => setNonce(nonce + 1)}>Try again</button></>;
  else if (!data) body = <Loading what="Loading your leagues from Sleeper and ESPN…" />;
  else if (hash.startsWith("league-")) body = <LeagueLoader data={data} entryKey={hash.slice(7)} />;
  else body = <LeaguesScreen data={data} rows={rows} onRefresh={refresh} />;

  return (
    <>
      <header className="appbar">
        <div className="wrap h-12 flex items-center justify-between">
          <a href="#leagues" className="font-bold text-lg tracking-tight logo">Fantasy<span style={{ color: "var(--brand)" }}>HQ</span></a>
          {ready && (
            <nav className="text-sm muted flex gap-5">
              <a href="#leagues" className={!hash || hash === "leagues" || hash.startsWith("league-") ? "navon" : ""}>My leagues</a>
              <a href="#espn" className={hash === "espn" ? "navon" : ""}>ESPN</a>
              <a href="#settings" className={hash === "settings" ? "navon" : ""}>Settings</a>
            </nav>
          )}
        </div>
      </header>
      <main className="wrap py-5">{body}</main>
    </>
  );
}

// ---------- Start ----------
function drawIcon(): string {
  const c = document.createElement("canvas"); c.width = c.height = 256;
  const g = c.getContext("2d")!;
  const grad = g.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, "#1f7a3d"); grad.addColorStop(1, "#0e4a24");
  g.fillStyle = grad; g.beginPath(); (g as any).roundRect(8, 8, 240, 240, 54); g.fill();
  // yard lines
  g.strokeStyle = "rgba(255,255,255,0.18)"; g.lineWidth = 4;
  for (const x of [64, 128, 192]) { g.beginPath(); g.moveTo(x, 30); g.lineTo(x, 226); g.stroke(); }
  // football
  g.save(); g.translate(128, 128); g.rotate(-Math.PI / 5);
  g.fillStyle = "#8a4b22"; g.beginPath(); g.ellipse(0, 0, 86, 50, 0, 0, Math.PI * 2); g.fill();
  g.strokeStyle = "#fff"; g.lineWidth = 7; g.beginPath(); g.moveTo(-34, 0); g.lineTo(34, 0); g.stroke();
  g.lineWidth = 6; for (const x of [-22, -7, 8, 23]) { g.beginPath(); g.moveTo(x, -12); g.lineTo(x, 12); g.stroke(); }
  g.restore();
  return c.toDataURL("image/png");
}

async function start() {
  const root = ReactDOM.createRoot(document.getElementById("root"));
  root.render(<main className="wrap py-5"><Loading what="Starting…" /></main>);
  let desktop: any = null;
  try { desktop = (await (window as any).claude?.use?.("desktop")) ?? null; } catch { desktop = null; }
  setDesktop(desktop);
  if (desktop?.childProcess) {
    desktop.app?.dock?.setIcon(drawIcon()).catch(() => {});
    desktop.window?.setOptions({ width: 1100, height: 820, minWidth: 420, minHeight: 500 }).catch(() => {});
  }
  root.render(<App desktop={desktop} />);
}
start();
