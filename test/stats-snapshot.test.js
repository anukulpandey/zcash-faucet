import test from "node:test";
import assert from "node:assert/strict";
import { merge, svg } from "../scripts/stats-snapshot.mjs";

test("snapshot merge never loses history", () => {
  const old = { drips: 12, tazSent: 1.2, donations: 2, tazDonated: 5, firstDrip: "2026-10-31T08:40:20.000Z", byDay: [{ day: "2026-10-31", drips: 11 }, { day: "2026-11-01", drips: 1 }] };
  // wallet was reset: the server only knows about one new day
  const s = merge(old, { drips: 3, tazSent: 0.3, donations: 0, tazDonated: 0, firstDrip: "2026-11-02T00:00:00.000Z", byDay: [{ day: "2026-11-02", drips: 3 }] });
  assert.deepEqual(s.byDay.map((d) => d.drips), [11, 1, 3]);
  assert.equal(s.drips, 15);
  assert.equal(s.tazDonated, 5);
  assert.equal(s.firstDrip, old.firstDrip);
  assert.equal((svg(s).match(/<rect/g) ?? []).length, 3);
  assert.match(svg(merge({}, { byDay: [] })), /^<svg/); // empty stats still draw
});
