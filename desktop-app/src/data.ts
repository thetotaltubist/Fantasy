// Loads leagues and works out the advice, using the same lib/ code as the website.
import {
  getUser, getNflState, getLeagues, getRosters, getLeagueUsers, getPlayers, rosterOf,
  playerName, rankOf, isBad, isConcern,
  type LeagueFull, type Roster, type LeagueUser, type Player, type NflState,
} from "@/lib/sleeper";
import { getEspnLeague, type EspnCreds } from "@/lib/espn";
import { waiverPicks, getTrending } from "@/lib/waivers";
import { tradeIdeas, dynastyTradeIdeas } from "@/lib/trades";
import { dynastySetup } from "@/lib/dynasty";
import { getProps, applyProps } from "@/lib/props";
import { getMatchups, outlook, LAST_WEEK } from "@/lib/matchups";
import { getEcr, getRos, blendWeekly, scoringKey, MIN_EXPERTS } from "@/lib/fantasypros";
import { setRosConsensus } from "@/lib/experts";
import { getLines, vegasMultiplier } from "@/lib/odds";
import { getProjections, getLockedTeams, projectPoints, adviseLineup, positionOf, type Proj } from "@/lib/projections";

export type Settings = { sleeper: string; espn: EspnCreds | null; fpKey: string; oddsKey: string; siteToken?: string };

export type Entry = {
  key: string;                       // "s-<league id>" or "e-<league id>"
  site: "Sleeper" | "ESPN"; l: LeagueFull; rosters: Roster[]; users: LeagueUser[]; mine: Roster; team?: string;
  players: Record<string, Player>;
};
export type Loaded = {
  state: NflState; players: Record<string, Player>; entries: Entry[];
  sleeperName?: string; sleeperError?: string;
  espnFailed: { id: string; error: string }[];
};

export async function loadAll(s: Settings): Promise<Loaded> {
  const [state, players] = await Promise.all([getNflState(), getPlayers()]);
  let sleeperName: string | undefined, sleeperError: string | undefined;
  const sleeper = (async (): Promise<Entry[]> => {
    if (!s.sleeper) return [];
    const user = await getUser(s.sleeper).catch(() => null);
    if (!user) { sleeperError = `Sleeper has no user named "${s.sleeper}".`; return []; }
    sleeperName = user.display_name;
    const leagues = (await getLeagues(user.user_id, state.season)) as LeagueFull[];
    const out = await Promise.all(leagues.map(async (l): Promise<Entry | null> => {
      const [rosters, users, full] = await Promise.all([getRosters(l.league_id), getLeagueUsers(l.league_id), Promise.resolve(l)]);
      const mine = rosterOf(rosters, user.user_id);
      if (!mine) return null;
      const team = users.find((u) => u.user_id === user.user_id)?.metadata?.team_name;
      return { key: `s-${l.league_id}`, site: "Sleeper", l: full, rosters, users, mine, team, players };
    }));
    return out.filter((e): e is Entry => e !== null);
  })();
  const espnFailed: Loaded["espnFailed"] = [];
  const espn = Promise.all((s.espn?.ids ?? []).map(async (id): Promise<Entry | null> => {
    const r = await getEspnLeague(id, state.season, s.espn!, players);
    if (!r.ok) { espnFailed.push({ id: r.id, error: r.error }); return null; }
    if (!r.mine) { espnFailed.push({ id, error: "Couldn't find your team in this league. Check the SWID code." }); return null; }
    return { key: `e-${r.league.league_id}`, site: "ESPN", l: r.league, rosters: r.rosters, users: r.users, mine: r.mine, team: r.team, players: r.players };
  }));
  const entries = [...(await sleeper), ...(await espn).filter((e): e is Entry => e !== null)]
    .sort((a, b) => a.l.name.localeCompare(b.l.name));
  return { state, players, entries, sleeperName, sleeperError, espnFailed };
}

// ---------- The list of leagues (website: app/_views/leagues-view.tsx) ----------
export async function summarize(d: Loaded) {
  const { state } = d;
  let projections: Record<string, Proj> = {};
  try { projections = await getProjections(state.season, state.week); } catch { /* show without advice */ }
  projections = applyProps(projections, d.players, await getProps()).projections;
  const lines = await getLines();
  const lockedTeams = await getLockedTeams(state.season, state.week);
  return Promise.all(d.entries.map(async (en) => {
    const { l, rosters, mine, team, players } = en;
    const locked = (id: string) => lockedTeams.has(positionOf(id, players[id]) === "DEF" ? id : players[id]?.team ?? "");
    const starters = (mine.starters ?? []).filter((id) => id !== "0");
    const out = starters.filter((id) => isBad(players[id]) && !locked(id));
    const q = starters.filter((id) => isConcern(players[id]) && !isBad(players[id]));
    const empty = (mine.starters ?? []).filter((id) => id === "0").length;
    const reserve = mine.reserve ?? [], taxi = mine.taxi ?? [];
    const benchIds = (mine.players ?? []).filter((id) => !(mine.starters ?? []).includes(id) && !reserve.includes(id) && !taxi.includes(id));
    const raw = (id: string) => {
      if (isBad(players[id])) return 0;
      const pos = positionOf(id, players[id]);
      const tm = pos === "DEF" ? id : players[id]?.team ?? "";
      return projectPoints(projections[id], l.scoring_settings ?? {}) * vegasMultiplier(lines, tm, pos, projections[id]?.opponent ?? null);
    };
    const weekly = await getEcr(state.season, state.week, scoringKey(l.scoring_settings));
    const pts = blendWeekly(Object.keys(projections), players, raw, weekly);
    const advice = adviseLineup({
      slots: l.roster_positions.filter((s) => s !== "BN" && s !== "IR" && s !== "TAXI"),
      starters: mine.starters ?? [], candidates: [...starters, ...benchIds], players, pts, locked,
    });
    const gain = l.settings?.best_ball ? 0 : advice.swaps.filter((w) => w.gain >= 0.5).reduce((t, w) => t + w.gain, 0);
    return {
      key: en.key, gain, proj: l.settings?.best_ball ? advice.best : advice.current,
      l, team, mine, site: en.site, rank: rankOf(rosters, mine), size: rosters.length,
      out: out.map((id) => playerName(players[id], id)), q: q.length, empty,
    };
  }));
}
export type Summary = Awaited<ReturnType<typeof summarize>>[number];

// ---------- One league (website: app/_views/league-view.tsx) ----------
export async function buildLeague(en: Entry, state: NflState, weekWanted: number) {
  const { l: league, rosters, users, players, mine } = en;
  const slots = league.roster_positions.filter((s) => s !== "BN" && s !== "IR" && s !== "TAXI");
  const starters = mine.starters ?? [];
  const reserve = mine.reserve ?? [];
  const taxi = mine.taxi ?? [];
  const bench = (mine.players ?? []).filter((id) => !starters.includes(id) && !reserve.includes(id) && !taxi.includes(id));
  const problems = starters.filter((id) => id === "0" || isBad(players[id])).length;

  const week = Math.min(18, Math.max(1, weekWanted || state.week));
  let projections: Record<string, Proj> = {};
  let projError = false;
  try { projections = await getProjections(state.season, week); } catch { projError = true; }
  const scoring = league.scoring_settings ?? {};
  const propped = applyProps(projections, players, await getProps());
  projections = propped.projections;
  const lines = await getLines();
  const teamFor = (id: string) => (/^[A-Z]{2,3}$/.test(id) && !players[id]?.team ? id : players[id]?.team ?? "");
  const base = (id: string) => (isBad(players[id]) ? 0 : projectPoints(projections[id], scoring));
  const mult = (id: string) => vegasMultiplier(lines, teamFor(id), positionOf(id, players[id]), projections[id]?.opponent ?? null);
  const withVegas = (id: string) => Math.round(base(id) * mult(id) * 10) / 10;
  const vegas = (id: string) => Math.round((withVegas(id) - base(id)) * 10) / 10;
  const sk = scoringKey(scoring);
  const [weekly, ros] = await Promise.all([getEcr(state.season, week, sk), getRos(state.season)]);
  setRosConsensus(ros.others, ros.dell);
  const pts = blendWeekly(Object.keys(projections), players, withVegas, weekly);
  const weeklyUsed = weekly.experts >= MIN_EXPERTS;
  const hasLines = Object.keys(lines.teams).length > 0;

  const [next1, next2, trending] = await Promise.all([
    getProjections(state.season, Math.min(18, week + 1)).catch(() => ({})),
    getProjections(state.season, Math.min(18, week + 2)).catch(() => ({})),
    getTrending(),
  ]);
  const matchups = await getMatchups(state.season, state.week).catch(() => null);
  const playoffStart = Math.min(LAST_WEEK, Math.max(state.week, league.settings?.playoff_week_start || 15));
  const playoffWeeks = Array.from({ length: LAST_WEEK - playoffStart + 1 }, (_, i) => playoffStart + i);
  const nextWeeks = [state.week, state.week + 1, state.week + 2].filter((w) => w < playoffStart);
  const SKILL = ["QB", "RB", "WR", "TE"];
  const look = (id: string, weeks: number[]) => outlook(matchups!, players[id]?.team, positionOf(id, players[id]), weeks);
  const tilt = (id: string) =>
    matchups && SKILL.includes(positionOf(id, players[id])) ? 1 + 0.3 * (look(id, playoffWeeks).avg - 1) : 1;
  const sched = !matchups ? [] : [...starters.filter((id) => id !== "0"), ...bench]
    .filter((id) => SKILL.includes(positionOf(id, players[id])) && players[id]?.team)
    .map((id) => ({ id, next: look(id, nextWeeks).list, po: look(id, playoffWeeks) }))
    .sort((a, b) => b.po.avg - a.po.avg);
  // Dynasty leagues: blend long-term dynasty value into waivers and trades.
  const dynasty = projError ? null : await dynastySetup({
    league, rosters, mine, players, weeks: [projections, next1, next2], scoring, tilt, site: en.site,
  });
  const picks = projError ? [] : waiverPicks({
    rosters, mine, players, weeks: [projections, next1, next2], scoring,
    slots: league.roster_positions, trending, tilt, dynasty: dynasty?.waivers,
  });
  const trades = projError ? [] : dynasty
    ? dynastyTradeIdeas({ rosters, mine, players, slots: league.roster_positions, ...dynasty.trades })
    : tradeIdeas({
      rosters, mine, players, weeks: [projections, next1, next2], scoring, slots: league.roster_positions, tilt,
    });
  const ownerName = (rosterId: number) => {
    const r = rosters.find((x) => x.roster_id === rosterId);
    const u = users.find((x) => x.user_id === r?.owner_id);
    return u?.metadata?.team_name?.trim() || u?.display_name || `Team ${rosterId}`;
  };
  const bestBall = !!league.settings?.best_ball;
  const lockedTeams = await getLockedTeams(state.season, week);
  const teamOf = (id: string) => (positionOf(id, players[id]) === "DEF" ? id : players[id]?.team ?? "");
  const locked = (id: string) => lockedTeams.has(teamOf(id));
  const allLocked = starters.filter((id) => id !== "0").every(locked);
  const advice = adviseLineup({ slots, starters, candidates: [...starters.filter((id) => id !== "0"), ...bench], players, pts, locked });
  const name = (id: string) => playerName(players[id], id);
  return {
    en, league, rosters, players, mine, team: en.team, state, week, slots, starters, reserve, taxi, bench, problems,
    projections, projError, propped: propped.used, pts, vegas, weekly, weeklyUsed, hasLines,
    matchups, playoffWeeks, nextWeeks, sched, picks, trades, dynasty, ownerName, bestBall, locked, allLocked, advice, name,
  };
}
export type LeagueModel = Awaited<ReturnType<typeof buildLeague>>;
