# Fantasy HQ Mac app

The website rebuilt as a Claude artifact that installs as a Mac app (Claude desktop app → artifact menu → Install as app).
It reuses `lib/` unchanged. Because an artifact page can't call other websites, requests go through the Mac's `curl`
via the artifact `desktop` capability (needs the "full-access" permission, which Claude asks for once).

- `src/net.ts`: the fetch used by `lib/` inside the app (curl, at most 6 at once; FantasyPros and Odds API answers kept a few hours).
- `src/data.ts`: loading and the advice math from the website's views.
- `src/app.tsx`: the pages. Settings (Sleeper username, API keys, ESPN codes) live in the app's own storage.

Build: `npm install && node build.mjs` → `dist/index.html`, then publish that file to the same artifact.
The paid Footballers file `private-data/footballers-ros.json` is bundled if present (it is not in git).
