// zcash-faucet server: a funded zcash-devtool wallet behind a tiny HTTP API.
//   GET  /             status page (balance, donation address, recent drips)
//   GET  /api/status   same, as JSON (the CLI reads githubClientId from here)
//   POST /api/claim    {address}  + "Authorization: Bearer <github token>"
// Zero dependencies: node:http + child_process + a JSON file for cooldowns.
import http from "node:http";
import { execFile } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, renameSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const env = (k, d) => process.env[k] ?? d;
const C = {
  port: +env("PORT", 8080),
  data: env("DATA_DIR", "./data"),
  bin: env("WALLET_BIN", "zcash-devtool"),
  network: env("NETWORK", "test"), // test | regtest
  lwd: env("LWD_SERVER", "zecrocks"), // zecrocks, or host:port for regtest
  dripZat: +env("DRIP_ZAT", 1_000_000), // 0.01 TAZ
  dailyCapZat: +env("DAILY_CAP_ZAT", 100_000_000), // 1 TAZ/day across everyone
  cooldownS: +env("COOLDOWN_HOURS", 24) * 3600,
  auth: env("AUTH", "github"), // github | none (none = local regtest only)
  ghClientId: env("GITHUB_CLIENT_ID", ""),
  minGhAgeDays: +env("MIN_GITHUB_AGE_DAYS", 30),
  explorer: env("EXPLORER_TX_URL", "https://testnet.zcashexplorer.app/transactions/"),
  syncEveryS: +env("SYNC_SECONDS", 60),
};
const walletDir = join(C.data, "wallet");
const identity = join(C.data, "identity.txt");
const dbFile = join(C.data, "claims.json");
mkdirSync(C.data, { recursive: true });

// --- state: {byGithub:{id:ts}, byAddress:{addr:ts}, drips:[{ts,txid,zat}]} ---
// ponytail: on an ephemeral disk (Render free) cooldowns reset on restart; rebuild them from the
// wallet's sent txs (OVK-decrypted memos/addresses) if restarts ever become an abuse vector.
const db = existsSync(dbFile) ? JSON.parse(readFileSync(dbFile, "utf8")) : { byGithub: {}, byAddress: {}, drips: [] };
const save = () => { writeFileSync(dbFile + ".tmp", JSON.stringify(db)); renameSync(dbFile + ".tmp", dbFile); };
const now = () => Math.floor(Date.now() / 1000);
const state = { address: null, balance: null, height: null, lastSyncOk: null, lastSyncError: null, started: now() };

// --- wallet: every call goes through one queue, zcash-devtool's sqlite is single-writer ---
let chain = Promise.resolve();
const wallet = (args, input) => {
  const run = () => new Promise((resolve, reject) => {
    const p = execFile(C.bin, ["wallet", "-w", walletDir, ...args], { timeout: 300_000, maxBuffer: 16 << 20 }, (err, stdout, stderr) =>
      err ? reject(new Error((stderr || err.message).trim().split("\n").slice(-3).join(" "))) : resolve(stdout));
    if (input) p.stdin.end(input);
  });
  const result = chain.then(run, run);
  chain = result.catch(() => {});
  return result;
};
const lwd = ["-s", C.lwd];

async function boot() {
  if (existsSync(join(walletDir, "data.sqlite"))) {
    // existing wallet on a persistent disk
  } else if (process.env.WALLET_SEED) {
    // Hosts with ephemeral disks (Render free): restore the same wallet every boot.
    console.log("Restoring wallet from WALLET_SEED");
    const birthday = process.env.WALLET_BIRTHDAY ? ["--birthday", process.env.WALLET_BIRTHDAY] : [];
    await wallet(["restore-mnemonic", "--name", "faucet", "-i", identity, "-n", C.network, ...birthday, ...lwd], process.env.WALLET_SEED.trim() + "\n");
  } else {
    console.log("No wallet yet, creating one. Back up the seed: zcash-devtool wallet -w", walletDir, "display-mnemonic --enable -i", identity);
    await wallet(["init", "--name", "faucet", "-i", identity, "-n", C.network, ...lwd]);
  }
  state.address = (await wallet(["list-addresses"])).match(/Default Address: (\S+)/)?.[1] ?? null;
  console.log("Faucet address:", state.address);
}

async function sync() {
  try {
    await wallet(["sync", ...lwd]);
    const b = JSON.parse((await wallet(["balance", "--json"])).trim().split("\n").pop());
    state.balance = b;
    state.height = b.chain_tip_height;
    state.lastSyncOk = now();
    state.lastSyncError = null;
  } catch (e) {
    state.lastSyncError = e.message;
    console.error("sync failed:", e.message);
  }
}
const spendable = () => (state.balance ? state.balance.orchard_spendable + state.balance.sapling_spendable + state.balance.transparent_spendable : 0);

// --- claim rules ---
export function checkAddress(addr, network = C.network) {
  const testnet = /^(utest1|ztestsapling1|tm|textest1)[0-9a-zA-Z]+$/;
  const regtest = /^(uregtest1|zregtestsapling1|tm)[0-9a-zA-Z]+$/;
  if (/^(u1|zs1|t1|t3|tex1)/.test(addr)) return "That's a mainnet address. This faucet pays testnet coins only.";
  if (!(network === "regtest" ? regtest : testnet).test(addr)) return "Not a valid testnet address (expected utest1…, ztestsapling1… or tm…).";
  return null;
}

async function githubUser(token) {
  const r = await fetch("https://api.github.com/user", { headers: { authorization: `Bearer ${token}`, "user-agent": "zcash-faucet" } });
  if (!r.ok) return null;
  return r.json();
}

const sentToday = () => db.drips.filter((d) => d.ts > now() - 86400).reduce((s, d) => s + d.zat, 0);
const wait = (ts) => (ts && now() - ts < C.cooldownS ? C.cooldownS - (now() - ts) : 0);

async function claim(req, body) {
  const address = String(body.address ?? "").trim();
  const bad = checkAddress(address);
  if (bad) return [400, { ok: false, error: bad }];

  let who = "anon";
  if (C.auth === "github") {
    const token = req.headers.authorization?.replace(/^Bearer /, "");
    const user = token && (await githubUser(token));
    if (!user) return [401, { ok: false, error: "GitHub login required. Run the CLI again to sign in.", needLogin: true }];
    const ageDays = (Date.now() - Date.parse(user.created_at)) / 864e5;
    if (ageDays < C.minGhAgeDays) return [403, { ok: false, error: `GitHub accounts must be at least ${C.minGhAgeDays} days old.` }];
    who = String(user.id);
    const w = wait(db.byGithub[who]);
    if (w) return [429, { ok: false, error: `@${user.login} already claimed today.`, retryAfterSeconds: w }];
  }
  const w = wait(db.byAddress[address]);
  if (w) return [429, { ok: false, error: "This address already got coins today.", retryAfterSeconds: w }];
  if (sentToday() + C.dripZat > C.dailyCapZat) return [503, { ok: false, error: "Daily payout cap reached. Try again tomorrow.", retryAfterSeconds: 3600 }];
  if (spendable() < C.dripZat + 10_000) return [503, { ok: false, error: "Faucet is dry or waiting on confirmations. Donate with: npx zcash-faucet --donate", retryAfterSeconds: 600 }];

  // Reserve first so parallel requests from the same user can't double-claim.
  db.byAddress[address] = now();
  if (who !== "anon") db.byGithub[who] = now();
  save();
  try {
    const out = await wallet(["send", "-i", identity, "--address", address, "--value", String(C.dripZat), "--memo", "Thanks for building on Zcash! (zcash-faucet)", "--target-note-count", "10", ...lwd], "y\n");
    const txid = out.match(/^[0-9a-f]{64}$/m)?.[0];
    db.drips.push({ ts: now(), txid, zat: C.dripZat });
    db.drips = db.drips.slice(-500);
    save();
    sync(); // refresh balance in the background
    return [200, { ok: true, txid, explorerUrl: txid ? C.explorer + txid : null, amountZat: C.dripZat, amountTaz: C.dripZat / 1e8 }];
  } catch (e) {
    delete db.byAddress[address];
    if (who !== "anon") delete db.byGithub[who];
    save();
    console.error("send failed:", e.message);
    return [502, { ok: false, error: `Send failed, your cooldown was not used: ${e.message}`, retryAfterSeconds: 120 }];
  }
}

function status() {
  const healthy = state.lastSyncOk && now() - state.lastSyncOk < C.syncEveryS * 5;
  return {
    ok: true,
    healthy: !!healthy,
    network: C.network === "test" ? "testnet" : C.network,
    dripTaz: C.dripZat / 1e8,
    cooldownSeconds: C.cooldownS,
    auth: C.auth,
    githubClientId: C.ghClientId || null,
    balanceTaz: state.balance ? state.balance.total / 1e8 : null,
    spendableTaz: spendable() / 1e8,
    height: state.height,
    lastSync: state.lastSyncOk,
    lastSyncError: state.lastSyncError,
    donationAddress: state.address,
    drips: { last24h: db.drips.filter((d) => d.ts > now() - 86400).length, allTime: db.drips.length },
    uptimeSeconds: now() - state.started,
  };
}

const page = (s) => `<!doctype html><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1">
<title>Zcash Testnet Faucet</title>
<style>body{font:15px/1.6 ui-monospace,Menlo,monospace;background:#0d0d0d;color:#e8e8e8;max-width:720px;margin:40px auto;padding:0 16px}
h1{color:#f4b728}code,.a{background:#1c1c1c;padding:2px 6px;border-radius:4px;word-break:break-all}.ok{color:#5fd068}.bad{color:#ff6b6b}td{padding:2px 16px 2px 0}a{color:#f4b728}</style>
<h1>ⓩ Zcash Testnet Faucet</h1>
<p>Get TAZ from your terminal: <code>npx zcash-faucet &lt;your-testnet-address&gt;</code></p>
<table>
<tr><td>status</td><td class=${s.healthy ? "ok>● online" : "bad>● degraded"}</td></tr>
<tr><td>network</td><td>${s.network}</td></tr>
<tr><td>balance</td><td>${s.balanceTaz ?? "syncing…"} TAZ (${s.spendableTaz} spendable)</td></tr>
<tr><td>drip</td><td>${s.dripTaz} TAZ / ${s.cooldownSeconds / 3600}h per GitHub account and address</td></tr>
<tr><td>drips</td><td>${s.drips.last24h} last 24h · ${s.drips.allTime} all-time</td></tr>
<tr><td>height</td><td>${s.height ?? "?"}</td></tr>
</table>
<h3>Donate TAZ back</h3><p class=a>${s.donationAddress ?? "…"}</p>
<p><a href="/api/status">/api/status</a> · <a href="https://github.com/anukulpandey/zcash-faucet">source</a></p>`;

const send = (res, code, body, type = "application/json") => {
  res.writeHead(code, { "content-type": type, "access-control-allow-origin": "*" });
  res.end(type === "application/json" ? JSON.stringify(body) : body);
};

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === "GET" && req.url === "/") return send(res, 200, page(status()), "text/html; charset=utf-8");
    if (req.method === "GET" && req.url === "/api/status") return send(res, 200, status());
    if (req.method === "POST" && req.url === "/api/claim") {
      let raw = "";
      for await (const chunk of req) if ((raw += chunk).length > 4096) return send(res, 413, { ok: false, error: "Body too large." });
      let body;
      try { body = JSON.parse(raw); } catch { return send(res, 400, { ok: false, error: "Invalid JSON." }); }
      const [code, out] = await claim(req, body);
      return send(res, code, out);
    }
    send(res, 404, { ok: false, error: "Not found." });
  } catch (e) {
    console.error(e);
    send(res, 500, { ok: false, error: "Internal error." });
  }
});

if (process.argv[1]?.endsWith("server.js")) {
  if (C.auth === "github" && !C.ghClientId) throw new Error("Set GITHUB_CLIENT_ID (or AUTH=none for local regtest).");
  server.listen(C.port, () => console.log(`zcash-faucet server on :${C.port} (${C.network}, auth=${C.auth})`));
  boot().then(sync).catch((e) => console.error("boot failed:", e.message));
  setInterval(sync, C.syncEveryS * 1000);
}
