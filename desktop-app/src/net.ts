// Network layer for the Mac app. An artifact page may not call other websites itself,
// so inside the installed app every request goes through the Mac's own `curl`
// (run with the desktop capability's childProcess, never through a shell).
// The website's lib/ code calls fetch(); this module provides a fetch that works here.

/* eslint-disable @typescript-eslint/no-explicit-any */
type Desktop = any;
let desktop: Desktop | null = null;
export function setDesktop(d: Desktop | null) { desktop = d; }
export const canFetch = () => !!desktop?.childProcess;

// API keys the website kept in Netlify settings live in this app's own storage instead.
export const ENV: Record<string, string | undefined> = {};
(globalThis as any).__ENV = ENV;

type Init = { headers?: Record<string, string>; method?: string; body?: string; cache?: string; next?: { revalidate?: number } };
export type Res = { ok: boolean; status: number; text(): Promise<string>; json(): Promise<any> };

const make = (status: number, body: string): Res => ({
  ok: status >= 200 && status < 300, status,
  text: async () => body,
  json: async () => JSON.parse(body),
});

// The app may run at most 32 processes at once; keep well under that.
const MAX = 6;
let running = 0;
const queue: (() => void)[] = [];
async function slot<T>(fn: () => Promise<T>): Promise<T> {
  if (running >= MAX) await new Promise<void>((r) => queue.push(r));
  running += 1;
  try { return await fn(); } finally { running -= 1; queue.shift()?.(); }
}

// Answers kept between launches, so paid APIs aren't asked again every time the app opens.
// Keys are stored with the API key taken out of the address.
const CACHE_PREFIX = "fhq-cache:";
function ttlFor(url: string, init?: Init): number {
  if (url.includes("api.fantasypros.com")) return 3 * 3600;
  if (url.includes("api.the-odds-api.com")) return init?.next?.revalidate ?? 3 * 3600;
  return 0;
}
const cacheKey = (url: string) => CACHE_PREFIX + url.replace(/apiKey=[^&]+/, "apiKey=");
function cached(url: string, ttl: number): Res | null {
  if (!ttl) return null;
  try {
    const raw = localStorage.getItem(cacheKey(url));
    if (!raw) return null;
    const { at, body } = JSON.parse(raw) as { at: number; body: string };
    return Date.now() - at < ttl * 1000 ? make(200, body) : null;
  } catch { return null; }
}
function store(url: string, ttl: number, body: string) {
  if (!ttl || body.length > 400_000) return;
  try { localStorage.setItem(cacheKey(url), JSON.stringify({ at: Date.now(), body })); } catch { /* storage full: skip */ }
}
export function clearCache() {
  try {
    for (const k of Object.keys(localStorage)) if (k.startsWith(CACHE_PREFIX)) localStorage.removeItem(k);
  } catch { /* nothing to clear */ }
}

const MARK = "\n@@FHQ_STATUS@@";

function curl(url: string, init?: Init): Promise<Res> {
  return slot(() => new Promise<Res>((resolve, reject) => {
    const args = ["-sS", "-L", "--compressed", "--max-time", "45", "-w", `${MARK}%{http_code}`];
    if (init?.method && init.method !== "GET") args.push("-X", init.method);
    for (const [k, v] of Object.entries(init?.headers ?? {})) args.push("-H", `${k}: ${v}`);
    if (init?.body) args.push("--data-binary", init.body);
    args.push("--", url);
    const out: string[] = [], err: string[] = [];
    let done = false;
    const child = desktop.childProcess.spawn("curl", args);
    child.stdout.on("data", (c: string) => out.push(c));
    child.stderr.on("data", (c: string) => err.push(c));
    child.on("error", (e: Error) => { if (!done) { done = true; reject(e); } });
    child.on("close", (code: number | null) => {
      if (done) return; done = true;
      const all = out.join("");
      const i = all.lastIndexOf(MARK);
      if (code !== 0 || i < 0) {
        const e = new Error(err.join("").trim() || `curl exited with ${code}`) as Error & { cause?: { code?: string } };
        e.cause = { code: `curl ${code}` };
        reject(e);
        return;
      }
      resolve(make(Number(all.slice(i + MARK.length)) || 0, all.slice(0, i)));
    });
  }));
}

// The website. With its password's token, FantasyPros and The Odds API are asked through the
// site, which adds its own API keys; the app never holds them.
export const SITE = "https://fantasy-hq-tubist.netlify.app";
export const SITE_KEY = "via-site";   // stands in for a key so lib/ goes ahead and asks
const viaSite = (url: string) => /^https:\/\/(api\.fantasypros\.com|api\.the-odds-api\.com)\//.test(url);

// Several leagues ask for the same rankings at the same moment: share one request.
const inFlight = new Map<string, Promise<{ status: number; body: string }>>();
export async function appFetch(input: string | URL, init?: Init): Promise<Res> {
  const url = String(input);
  if (init?.method && init.method !== "GET") return fetchOnce(url, init);
  const k = `${url}|${JSON.stringify(init?.headers ?? {})}`;
  let p = inFlight.get(k);
  if (!p) {
    p = fetchOnce(url, init).then(async (r) => ({ status: r.status, body: await r.text() }));
    inFlight.set(k, p);
    p.finally(() => inFlight.delete(k)).catch(() => {});
  }
  const r = await p;
  return make(r.status, r.body);
}

async function fetchOnce(url: string, init?: Init): Promise<Res> {
  const ttl = ttlFor(url, init);
  const hit = cached(url, ttl);
  if (hit) return hit;
  if (!desktop?.childProcess) throw new Error("This only works in the installed Mac app.");
  let res: Res;
  if (viaSite(url) && ENV.SITE_TOKEN && (url.includes(`apiKey=${SITE_KEY}`) || init?.headers?.["x-api-key"] === SITE_KEY)) {
    const clean = url.replace(/([?&])apiKey=[^&]*&?/, "$1").replace(/[?&]$/, "");
    res = await curl(`${SITE}/api/upstream?u=${encodeURIComponent(clean)}`, { headers: { Authorization: `Bearer ${ENV.SITE_TOKEN}` } });
  } else {
    res = await curl(url, init);
  }
  if (res.ok && ttl) store(url, ttl, await res.text());
  return res;
}

// Checks the website password and asks which keys the site has.
export async function siteToken(password: string) {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`fantasy-hq:${password}`));
  return Array.from(new Uint8Array(hash), (b) => b.toString(16).padStart(2, "0")).join("");
}
export async function checkSite(token: string): Promise<{ ok: boolean; note: string }> {
  try {
    const res = await curl(`${SITE}/api/upstream`, { headers: { Authorization: `Bearer ${token}` } });
    if (res.status === 401) return { ok: false, note: "The website didn't accept that password." };
    if (res.status === 404) return { ok: false, note: "The website hasn't been updated to share its keys yet." };
    if (!res.ok) return { ok: false, note: `The website answered ${res.status}.` };
    const body = await res.text();
    if (!body.trim().startsWith("{")) {
      return { ok: false, note: "Netlify's team sign-in page is in front of the website, so the app can't reach it. Turn that off for the live site in Netlify, or use your own keys below." };
    }
    const d = JSON.parse(body);
    const have = [d.fantasypros && "FantasyPros", d.odds && "betting lines"].filter(Boolean);
    return { ok: true, note: have.length ? `Connected. Using the website's keys for ${have.join(" and ")}.` : "Connected, but the website has no API keys set." };
  } catch (e) { return { ok: false, note: `Couldn't reach the website (${String((e as Error)?.message ?? e).slice(0, 80)}).` }; }
}

// Every fetch() in the shared lib/ code is pointed at the function above when the app is built
// (the page's own window.fetch is left alone for Claude's runtime).
(globalThis as any).__appFetch = appFetch;
