// Builds the static status page for Vercel from the server's own page(). Run: npm run site
// Values start as placeholders; the page fills them from /api/status, which Vercel forwards to the wallet server.
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
process.env.DATA_DIR = mkdtempSync(join(tmpdir(), "zf-site-")); // importing the server touches its data dir
const { page } = await import("../server/server.js");
const placeholder = { dripTaz: 0.1, cooldownSeconds: 86400, network: "testnet", drips: { last24h: "…", allTime: "…" }, height: "…", balanceTaz: "…" };
writeFileSync(new URL("index.html", import.meta.url), page(placeholder));
console.log("wrote site/index.html");
