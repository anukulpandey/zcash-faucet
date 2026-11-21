#!/usr/bin/env node
// Daily backup of the faucet's stats: `curl $FAUCET_URL/api/stats | node scripts/stats-snapshot.mjs`
// merges the response into stats/stats.json and redraws stats/drips.svg (shown in the README).
// The merge only ever grows, so a wallet reset, testnet reset or bad response can't erase history.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";

export function merge(old, cur) {
  const by = {};
  for (const d of [...(old.byDay ?? []), ...(cur.byDay ?? [])]) by[d.day] = Math.max(by[d.day] ?? 0, d.drips);
  const byDay = Object.keys(by).sort().map((day) => ({ day, drips: by[day] }));
  const max = (k) => Math.max(old[k] ?? 0, cur[k] ?? 0);
  return {
    // ponytail: after a wallet reset the day counts keep growing but tazSent/donations stay at the old high-water mark
    drips: Math.max(max("drips"), byDay.reduce((a, d) => a + d.drips, 0)),
    tazSent: max("tazSent"),
    donations: max("donations"),
    tazDonated: max("tazDonated"),
    firstDrip: [old.firstDrip, cur.firstDrip].filter(Boolean).sort()[0] ?? null,
    byDay,
  };
}

export function svg(s) {
  const W = 800, H = 250, top = 70, bottom = 24, by = Object.fromEntries(s.byDay.map((d) => [d.day, d.drips]));
  const days = [];
  if (s.byDay.length) for (let t = Date.parse(s.byDay[0].day), end = Date.parse(s.byDay.at(-1).day); t <= end; t += 864e5) days.push(new Date(t).toISOString().slice(0, 10));
  const peak = Math.max(1, ...Object.values(by)), bw = W / Math.max(days.length, 1), ph = H - top - bottom;
  const bars = days.map((day, i) => {
    const n = by[day] ?? 0, h = (n / peak) * ph;
    return `<rect x="${(i * bw + bw * 0.1).toFixed(1)}" y="${(top + ph - h).toFixed(1)}" width="${(bw * 0.8).toFixed(1)}" height="${h.toFixed(1)}" rx="2"><title>${day}: ${n}</title></rect>`;
  }).join("");
  const title = `${s.tazSent.toFixed(2)} TAZ sent · ${s.donations} donations (${s.tazDonated.toFixed(2)} TAZ) · peak ${peak}/day`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" font-family="ui-monospace,monospace" font-size="13" fill="#888">
<text x="0" y="30" font-size="32" font-weight="700" fill="#f4b728">${s.drips.toLocaleString("en-US")}<tspan font-size="15" font-weight="400" fill="#888" dx="8">drips so far</tspan></text>
<text x="0" y="54">${title}</text>
<g fill="#f4b728">${bars}</g>
<text x="0" y="${H - 6}">${days[0] ?? ""}</text><text x="${W}" y="${H - 6}" text-anchor="end">${days.at(-1) ?? ""}</text>
</svg>
`;
}

if (import.meta.filename === process.argv[1]) {
  const cur = JSON.parse(readFileSync(0, "utf8"));
  if (cur.ok !== true || !Array.isArray(cur.byDay)) throw new Error("unexpected /api/stats response");
  const file = "stats/stats.json";
  const s = merge(existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {}, cur);
  mkdirSync("stats", { recursive: true });
  writeFileSync(file, JSON.stringify(s, null, 2) + "\n");
  writeFileSync("stats/drips.svg", svg(s));
  console.log(`${s.drips} drips over ${s.byDay.length} days`);
}
