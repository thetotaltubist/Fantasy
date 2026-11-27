// Paid ranking files are kept out of the public repo. If one is missing,
// create an empty stand-in so the site still builds.
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
mkdirSync("private-data", { recursive: true });
for (const f of ["private-data/footballers-ros.json", "private-data/footballers-dynasty.json"]) {
  if (!existsSync(f)) writeFileSync(f, JSON.stringify({ source: "", asOf: "", players: [] }));
}
