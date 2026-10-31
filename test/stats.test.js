import assert from "node:assert";
import { test } from "node:test";
import { summarize } from "../server/server.js";

test("usage stats from wallet history", () => {
  const day = (iso) => Date.parse(iso) / 1000;
  const rows = [
    { t: day("2026-10-30T22:00:00Z"), d: 2_000_000_000 }, // donation
    { t: day("2026-10-31T08:00:00Z"), d: -55_000 }, // self-send: fee only
    { t: day("2026-10-31T09:00:00Z"), d: -10_010_000 }, // drip
    { t: day("2026-11-01T09:00:00Z"), d: -10_015_000 }, // drip
  ];
  const s = summarize(rows, 10_000_000, day("2026-11-01T12:00:00Z"));
  assert.equal(s.drips, 2);
  assert.equal(s.dripsLast24h, 1);
  assert.equal(s.donations, 1);
  assert.equal(s.tazDonated, 20);
  assert.equal(s.tazSent, 0.20025);
  assert.deepEqual(s.byDay, [{ day: "2026-10-31", drips: 1 }, { day: "2026-11-01", drips: 1 }]);
});

test("status page script parses", async () => {
  const { page } = await import("../server/server.js");
  const html = page({ dripTaz: 0.1, cooldownSeconds: 86400, network: "testnet", drips: { last24h: 0, allTime: 0 } });
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  assert.ok(scripts.length);
  for (const js of scripts) new Function(js); // throws SyntaxError if the page would break
});
