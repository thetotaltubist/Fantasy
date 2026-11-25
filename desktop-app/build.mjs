// Builds the Mac app artifact: one HTML page with the app's code inlined.
// Run from desktop-app/: `npm install && node build.mjs`  ->  dist/index.html
// It reuses the website's lib/ code unchanged. The paid Footballers rankings file
// (private-data/footballers-ros.json, kept out of git) is bundled when present.
import { build } from "esbuild";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";

if (!existsSync("../private-data/footballers-ros.json")) {
  mkdirSync("../private-data", { recursive: true });
  writeFileSync("../private-data/footballers-ros.json", JSON.stringify({ source: "", asOf: "", players: [] }));
  console.warn("No Footballers rankings file: building without it.");
}

const out = await build({
  entryPoints: ["src/app.tsx"],
  bundle: true, write: false, format: "iife", target: "es2020", minify: true,
  tsconfig: "../tsconfig.json",
  jsxFactory: "React.createElement", jsxFragment: "React.Fragment",
  define: {
    fetch: "globalThis.__appFetch",
    "process.env.FANTASYPROS_API_KEY": "globalThis.__ENV.FANTASYPROS_API_KEY",
    "process.env.ODDS_API_KEY": "globalThis.__ENV.ODDS_API_KEY",
    "process.env.NODE_ENV": '"production"',
  },
  legalComments: "none",
});
mkdirSync("dist", { recursive: true });
const js = out.outputFiles[0].text.replace(/<\/script/gi, "<\\/script");
// Tailwind classes are compiled now, so the app needs no style compiler at run time.
execFileSync("node_modules/.bin/tailwindcss", ["-c", "tailwind.config.cjs", "-i", "src/tw.css", "-o", "dist/tw.css", "--minify"], { stdio: "inherit" });
const css = readFileSync("dist/tw.css", "utf8");
const html = readFileSync("src/shell.html", "utf8").replace("/*TAILWIND*/", () => css).replace("/*BUNDLE*/", () => js);
mkdirSync("dist", { recursive: true });
writeFileSync("dist/index.html", html);
console.log(`dist/index.html ${(html.length / 1024).toFixed(0)} KB`);
