// Dynasty leagues: long-term trade values from FantasyCalc (built from real dynasty trades),
// which cover age, upside and rookie draft picks. Waivers and trades in a dynasty league
// use these alongside the usual next-three-weeks value.
import { getTradedPicks, rankOf, type Player, type Roster, type LeagueFull } from "@/lib/sleeper";
import { positionOf, type Proj } from "@/lib/projections";
import { makeValuer } from "@/lib/value";
import type { DynastyWaivers } from "@/lib/waivers";
import { norm } from "@/lib/experts";
import fbRaw from "@/private-data/footballers-dynasty.json";

// The Fantasy Footballers' dynasty rankings (uploaded file, kept out of the public repo).
type FbRow = { name: string; team: string; pos: string; age: number | null; rank: number };
const fb = fbRaw as { source: string; asOf: string; players: FbRow[] };
const fbByKey = new Map<string, FbRow>();
for (const r of fb.players) fbByKey.set(`${norm(r.name)}|${r.pos}`, r);
export const footballersDynasty = { count: fb.players.length, asOf: fb.asOf };

// Half FantasyCalc, half the Footballers. Their overall rank is turned into a value by
// reading off what FantasyCalc gives the player at that same overall rank.
const blended = new WeakMap<Dynasty, Dynasty>();
export function withFootballers(dyn: Dynasty, players: Record<string, Player>): Dynasty {
  if (!fb.players.length) return dyn;
  const hit = blended.get(dyn); if (hit) return hit;
  const ladder = [...dyn.byId.values()].map((d) => d.value).sort((a, b) => b - a);
  const at = (rank: number) => ladder[Math.min(ladder.length - 1, rank - 1)] ?? 0;
  const byId = new Map(dyn.byId);
  for (const [id, p] of Object.entries(players)) {
    if (!p?.position || !["QB", "RB", "WR", "TE"].includes(p.position)) continue;
    const name = p.full_name ?? `${p.first_name ?? ""} ${p.last_name ?? ""}`.trim();
    const r = name ? fbByKey.get(`${norm(name)}|${p.position}`) : undefined;
    if (!r) continue;
    const fc = dyn.byId.get(id);
    const v = at(r.rank);
    byId.set(id, fc
      ? { ...fc, value: Math.round((fc.value + v) / 2) }
      : { value: v, redraft: 0, age: r.age, pos: p.position });
  }
  const out = { ...dyn, byId };
  blended.set(dyn, out);
  return out;
}

export type DynPlayer = { value: number; redraft: number; age: number | null; pos: string };
export type Dynasty = {
  byId: Map<string, DynPlayer>;      // Sleeper player id -> values
  picks: Map<string, number>;        // "2027 1st (Early)", "2028 2nd", ... -> value
  updated: string;
};

const memo = new Map<string, { at: number; d: Dynasty }>();

// numTeams and ppr change the values a little; numQbs is 2 in superflex leagues.
export async function getDynasty(opts: { numTeams: number; superflex: boolean; ppr: number }): Promise<Dynasty | null> {
  const ppr = opts.ppr >= 1 ? 1 : opts.ppr >= 0.5 ? 0.5 : 0;
  const teams = Math.min(16, Math.max(8, opts.numTeams || 12));
  const q = `isDynasty=true&numQbs=${opts.superflex ? 2 : 1}&numTeams=${teams}&ppr=${ppr}`;
  const hit = memo.get(q);
  if (hit && Date.now() - hit.at < 6 * 3600_000) return hit.d;
  try {
    const res = await fetch(`https://api.fantasycalc.com/values/current?${q}`, { next: { revalidate: 6 * 3600 } });
    if (!res.ok) return hit?.d ?? null;
    const rows = (await res.json()) as {
      player: { name: string; sleeperId: string | null; position: string; maybeAge: number | null };
      value: number; redraftValue: number;
    }[];
    const d: Dynasty = { byId: new Map(), picks: new Map(), updated: new Date().toISOString().slice(0, 10) };
    for (const r of rows) {
      if (r.player.position === "PICK") d.picks.set(r.player.name, r.value);
      else if (r.player.sleeperId) d.byId.set(r.player.sleeperId, { value: r.value, redraft: r.redraftValue ?? 0, age: r.player.maybeAge, pos: r.player.position });
    }
    if (!d.byId.size) return hit?.d ?? null;
    memo.set(q, { at: Date.now(), d });
    return d;
  } catch { return hit?.d ?? null; }
}

// How much long-term value counts against this season, by where the team sits.
// Contenders still care about now; teams out of the race build for next year.
export function dynastyWeight(rank: number, teams: number, playoffTeams: number) {
  if (rank <= playoffTeams) return 0.6;
  if (rank > teams - Math.floor((teams - playoffTeams) / 2)) return 0.85;
  return 0.7;
}
export const teamMode = (w: number) => (w >= 0.85 ? "rebuilding" : w <= 0.6 ? "contending" : "in the middle");

// One score per player in FantasyCalc's units: the dynasty value, blended with the
// near-term value (points per game) converted to the same scale by position rank.
export function dynastyScorer(opts: {
  players: Record<string, Player>; ids: string[]; now: (id: string) => number; dyn: Dynasty;
}) {
  const { players, ids, now, dyn } = opts;
  const pos = (id: string) => positionOf(id, players[id]);
  const ladders: Record<string, number[]> = {};
  for (const d of dyn.byId.values()) (ladders[d.pos] ??= []).push(d.redraft);
  for (const l of Object.values(ladders)) l.sort((a, b) => b - a);
  const nowFc = new Map<string, number>();
  const byPos: Record<string, { id: string; v: number }[]> = {};
  for (const id of new Set(ids)) { const v = now(id); if (v > 0) (byPos[pos(id)] ??= []).push({ id, v }); }
  for (const [p, list] of Object.entries(byPos)) {
    list.sort((a, b) => b.v - a.v);
    list.forEach((x, i) => nowFc.set(x.id, ladders[p]?.[i] ?? 0));
  }
  const info = (id: string) => dyn.byId.get(id) ?? null;
  const cache = new Map<string, number>();
  const score = (id: string, weight: number) => {
    const k = `${id}|${weight}`;
    let v = cache.get(k);
    if (v === undefined) {
      v = Math.round(weight * (info(id)?.value ?? 0) + (1 - weight) * (nowFc.get(id) ?? 0));
      cache.set(k, v);
    }
    return v;
  };
  return { score, info };
}

// ---------- Rookie draft picks ----------
export type Pick = { season: string; round: number; from: number; label: string; value: number };
type Traded = { season: string; round: number; roster_id: number; owner_id: number };
const ORD = ["", "1st", "2nd", "3rd", "4th"];

// Every future pick each team owns, valued. Next year's picks are called early, mid or
// late from the original team's place in the standings now.
export function ownedPicks(opts: {
  rosters: Roster[]; traded: Traded[]; season: string; rounds: number; dyn: Dynasty; rankOf: (r: Roster) => number;
}): Map<number, Pick[]> {
  const { rosters, traded, season, dyn } = opts;
  const rounds = Math.min(4, opts.rounds || 4);
  const n = rosters.length;
  const out = new Map<number, Pick[]>();
  for (const r of rosters) out.set(r.roster_id, []);
  const next = String(Number(season) + 1);
  for (let y = 1; y <= 3; y++) {
    const s = String(Number(season) + y);
    for (const orig of rosters) for (let rd = 1; rd <= rounds; rd++) {
      const t = traded.find((x) => x.season === s && x.round === rd && x.roster_id === orig.roster_id);
      const owner = t ? t.owner_id : orig.roster_id;
      let label = `${s} ${ORD[rd]}`, value = dyn.picks.get(label);
      if (s === next) {
        const rank = opts.rankOf(orig);
        const slot = rank <= n / 3 ? "Late" : rank > (2 * n) / 3 ? "Early" : "Mid";
        const v = dyn.picks.get(`${label} (${slot})`);
        if (v) { label = `${label} (${slot})`; value = v; }
      }
      if (value) out.get(owner)?.push({ season: s, round: rd, from: orig.roster_id, label, value });
    }
  }
  for (const l of out.values()) l.sort((a, b) => a.value - b.value);
  return out;
}

export const fmtValue = (n: number) => Math.round(n).toLocaleString("en-US");

// Everything a dynasty league page needs, or null for other leagues (or if values can't load).
// Used by the website's league page and the Mac app alike.
export async function dynastySetup(opts: {
  league: LeagueFull; rosters: Roster[]; mine: Roster; players: Record<string, Player>;
  weeks: Record<string, Proj>[]; scoring: Record<string, number>; tilt?: (id: string) => number; site: string;
}) {
  const { league, rosters, mine, players, weeks, scoring } = opts;
  if (league.settings?.type !== 2) return null;
  const fcDyn = await getDynasty({
    numTeams: rosters.length, superflex: league.roster_positions.includes("SUPER_FLEX"), ppr: scoring.rec ?? 0,
  });
  if (!fcDyn) return null;
  const dyn = withFootballers(fcDyn, players);
  const n = rosters.length, playoffTeams = league.settings?.playoff_teams || Math.ceil(n / 2);
  const weightOf = (r: Roster) => dynastyWeight(rankOf(rosters, r), n, playoffTeams);
  const { value } = makeValuer(players, weeks, scoring, opts.tilt);
  const rostered = rosters.flatMap((r) => [...(r.players ?? []), ...(r.reserve ?? []), ...(r.taxi ?? [])]);
  const { score, info } = dynastyScorer({ players, ids: [...Object.keys(weeks[0] ?? {}), ...rostered], now: value, dyn });
  // Draft picks only come from Sleeper.
  const traded = opts.site === "Sleeper" ? await getTradedPicks(league.league_id).catch(() => []) : [];
  const picks = ownedPicks({
    rosters, traded, season: league.season, rounds: league.settings?.draft_rounds ?? 4, dyn, rankOf: (r) => rankOf(rosters, r),
  });
  const weight = weightOf(mine);
  const waivers: DynastyWaivers = { score: (id) => score(id, weight), info, ids: [...dyn.byId.keys()] };
  return { dyn, weight, mode: teamMode(weight), waivers, trades: { score, info, weightOf, picks } };
}
export type DynastySetup = NonNullable<Awaited<ReturnType<typeof dynastySetup>>>;

export const dynastyNote = (d: DynastySetup) =>
  `Dynasty league: values are ${fb.players.length ? `half FantasyCalc dynasty trade values, half the Fantasy Footballers' dynasty rankings (${fb.asOf})` : "FantasyCalc dynasty trade values"} (age, long-term outlook and rookie picks), ` +
  `blended with the next three weeks. Your team looks ${d.mode}, so long-term value counts ${Math.round(d.weight * 100)}%.`;
