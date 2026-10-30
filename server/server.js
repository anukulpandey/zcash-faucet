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
  dripZat: +env("DRIP_ZAT", 10_000_000), // 0.1 TAZ
  dailyCapZat: +env("DAILY_CAP_ZAT", 500_000_000), // 5 TAZ/day across everyone
  cooldownS: +env("COOLDOWN_HOURS", 24) * 3600,
  auth: env("AUTH", "github"), // github | none (none = local regtest only)
  ghClientId: env("GITHUB_CLIENT_ID", ""),
  ghClientSecret: env("GITHUB_CLIENT_SECRET", ""), // lets the server verify + revoke login tokens
  githubApi: env("GITHUB_API", "https://api.github.com"), // overridden only by tests
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

// Identity check for a GitHub device-flow token. Tokens not issued to this faucet's OAuth app, or carrying
// any scopes, are refused before they are used at all; every token is revoked right after the check so it
// can never be reused. The token is never stored or logged.
const gh = (path, init = {}) => fetch(C.githubApi + path, { ...init, headers: { "user-agent": "zcash-faucet", accept: "application/vnd.github+json", ...init.headers } });
const appAuth = () => ({ authorization: "Basic " + Buffer.from(`${C.ghClientId}:${C.ghClientSecret}`).toString("base64") });

async function githubUser(token) {
  const check = await gh(`/applications/${C.ghClientId}/token`, { method: "POST", headers: appAuth(), body: JSON.stringify({ access_token: token }) });
  if (!check.ok) return null; // not a token of this app: never used
  const { scopes } = await check.json();
  try {
    if (scopes?.length) return null;
    const r = await gh("/user", { headers: { authorization: `Bearer ${token}` } });
    return r.ok ? await r.json() : null;
  } finally {
    await revoke(token);
  }
}

async function revoke(token) {
  await gh(`/applications/${C.ghClientId}/token`, { method: "DELETE", headers: appAuth(), body: JSON.stringify({ access_token: token }) })
    .catch((e) => console.error("token revoke failed:", e.message));
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
    version: "1.1.0", // bump with package.json; shows which server build is live
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

const BANNER = String.raw`    .-~~~~~~-.
  .'  ______  '.
 /   |___  /    \    ███████╗ ██████╗ █████╗ ███████╗██╗  ██╗
|  ===  / /===   |   ╚══███╔╝██╔════╝██╔══██╗██╔════╝██║  ██║
|      / /       |     ███╔╝ ██║     ███████║███████╗███████║
|  ===/ /____=== |    ███╔╝  ██║     ██╔══██║╚════██║██╔══██║
 \   /______|   /    ███████╗╚██████╗██║  ██║███████║██║  ██║
  '.          .'     ╚══════╝ ╚═════╝╚═╝  ╚═╝╚══════╝╚═╝  ╚═╝
    '-.____.-'         t e s t n e t   ·   f a u c e t`;

// Status page: a fake terminal session. Values render server-side and refresh every 30s from /api/status.
const page = (s) => `<!doctype html><html lang=en><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1">
<title>Zcash Testnet Faucet</title>
<meta name=description content="Zcash testnet coins (TAZ) from your terminal: npx zcash-faucet <address>">
<link rel=icon href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>ⓩ</text></svg>">
<style>
:root{--bg:#07080a;--win:#0e1013;--bar:#16191e;--fg:#d7dae0;--dim:#6b7280;--gold:#f4b728;--green:#4ade80;--red:#f87171;--cyan:#67e8f9;--line:#23272e}
*{box-sizing:border-box}
body{margin:0;min-height:100vh;background:radial-gradient(ellipse at top,#14110a 0%,var(--bg) 60%);color:var(--fg);font:14px/1.55 "JetBrains Mono",ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;padding:32px 16px}
.win{max-width:860px;margin:0 auto;background:var(--win);border:1px solid var(--line);border-radius:10px;box-shadow:0 30px 80px #000a,0 0 0 1px #f4b72810,0 0 60px #f4b72812;overflow:hidden}
.bar{display:flex;align-items:center;gap:8px;padding:10px 14px;background:var(--bar);border-bottom:1px solid var(--line);color:var(--dim);font-size:12px}
.bar i{width:12px;height:12px;border-radius:50%;display:inline-block}.bar span{margin:0 auto;padding-right:52px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.body{padding:20px 22px 26px;position:relative}
.body::after{content:"";pointer-events:none;position:absolute;inset:0;background:repeating-linear-gradient(0deg,#ffffff05 0 1px,transparent 1px 3px)}
pre{margin:0;font:inherit;white-space:pre}
.banner{color:var(--gold);font-family:Menlo,"DejaVu Sans Mono",Consolas,ui-monospace,monospace;font-size:min(13px,2.35vw);line-height:1;letter-spacing:0;text-shadow:0 0 12px #f4b72855;overflow-x:auto;padding-bottom:4px}
.tag{color:var(--dim);margin:10px 0 18px}
.p{color:var(--green)}.p::before{content:"➜ ";color:var(--green)}.c{color:var(--fg)}.cm{color:var(--dim)}
.row{display:grid;grid-template-columns:110px 1fr;gap:12px;padding-left:16px}.k{color:var(--dim)}
.ok{color:var(--green)}.bad{color:var(--red)}.gold{color:var(--gold)}.cy{color:var(--cyan)}
.blk{margin:0 0 18px}
.addr{color:var(--cyan);word-break:break-all;padding-left:16px;display:block}
button{font:inherit;font-size:12px;background:transparent;color:var(--gold);border:1px solid #f4b72866;border-radius:5px;padding:1px 8px;margin-left:10px;cursor:pointer}
button:hover{background:#f4b72818}button:focus-visible{outline:2px solid var(--gold);outline-offset:2px}
a{color:var(--gold);text-decoration:none;border-bottom:1px dotted #f4b72888}a:hover{border-bottom-style:solid}
.cur{display:inline-block;width:8px;height:16px;background:var(--fg);vertical-align:text-bottom;animation:b 1.1s steps(1) infinite}
@keyframes b{50%{opacity:0}}
@media (prefers-reduced-motion:reduce){.cur{animation:none}}
@media (max-width:560px){body{padding:16px 10px;font-size:12.5px}.body{padding:16px 14px 20px}.row{grid-template-columns:84px 1fr;padding-left:8px}.addr{padding-left:8px}}
</style>
<div class=win role=main>
<div class=bar><i style="background:#ff5f57"></i><i style="background:#febc2e"></i><i style="background:#28c840"></i><span>zcash-faucet — testnet — 80×24</span></div>
<div class=body>
<pre class=banner aria-label="Zcash testnet faucet">${BANNER}</pre>
<div class=tag>Testnet TAZ, straight to your terminal. One command, sign in with GitHub once.</div>

<div class=blk><span class=p></span><span class=c>npx zcash-faucet &lt;your-testnet-address&gt;</span><button data-copy="npx zcash-faucet ">copy</button>
<div class=cm style="padding-left:16px"># utest1… · ztestsapling1… · tm…   ${s.dripTaz} TAZ per GitHub account &amp; address every ${s.cooldownSeconds / 3600}h</div></div>

<div class=blk><span class=p></span><span class=c>npx zcash-faucet --status</span>
<div class=row><span class=k>health</span><span id=health class=${s.healthy ? "ok>● online" : "bad>● degraded"}</span></div>
<div class=row><span class=k>network</span><span>${s.network}</span></div>
<div class=row><span class=k>reserve</span><span><span id=meter class=gold>${meter(s)}</span> <span id=bal>${s.balanceTaz ?? "syncing…"}</span> TAZ</span></div>
<div class=row><span class=k>claims left</span><span id=left>${Math.floor(s.spendableTaz / s.dripTaz)}</span></div>
<div class=row><span class=k>drips</span><span><span id=d24>${s.drips.last24h}</span> last 24h · <span id=dall>${s.drips.allTime}</span> all-time</span></div>
<div class=row><span class=k>height</span><span id=h>${s.height ?? "?"}</span></div>
</div>

<div class=blk><span class=p></span><span class=c>npx zcash-faucet --donate</span><button data-copy="${s.donationAddress ?? ""}">copy address</button>
<div class=cm style="padding-left:16px"># done testing? send leftover TAZ back so the next dev gets some</div>
<span class=addr>${s.donationAddress ?? "…"}</span></div>

<div class=blk><span class=p></span><span class=c>cat HOW_IT_WORKS</span>
<pre class=cm style="padding-left:16px;white-space:pre-wrap">CLI ──GitHub device login──▶ faucet API ──zcash-devtool──▶ lightwalletd ──▶ testnet
no captchas · no IP limits (campus Wi-Fi works) · small drips · daily cap</pre></div>

<div class=blk><span class=p></span><span class=c>open</span> <a href="https://github.com/anukulpandey/zcash-faucet">github</a> · <a href="https://www.npmjs.com/package/zcash-faucet">npm</a> · <a href="/api/status">/api/status</a></div>
<span class=p></span><span class=cur></span>
</div></div>
<script>
document.addEventListener("click",e=>{const b=e.target.closest("[data-copy]");if(!b)return;navigator.clipboard.writeText(b.dataset.copy).then(()=>{const t=b.textContent;b.textContent="copied ✔";setTimeout(()=>b.textContent=t,1200)})});
const meter=${meter.toString()};
setInterval(async()=>{try{const s=await (await fetch("/api/status")).json();const $=id=>document.getElementById(id);
$("health").className=s.healthy?"ok":"bad";$("health").textContent=s.healthy?"● online":"● degraded";
$("meter").textContent=meter(s);$("bal").textContent=s.balanceTaz??"syncing…";$("left").textContent=Math.floor(s.spendableTaz/s.dripTaz);
$("d24").textContent=s.drips.last24h;$("dall").textContent=s.drips.allTime;$("h").textContent=s.height??"?"}catch{}},30000);
</script></html>`;
// Reserve bar: full at 100 drips' worth.
function meter(s) { const n = Math.max(0, Math.min(20, Math.round((s.spendableTaz / (s.dripTaz * 100)) * 20))); return "[" + "█".repeat(n) + "░".repeat(20 - n) + "]"; }

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
  if (C.auth === "github" && !(C.ghClientId && C.ghClientSecret)) throw new Error("Set GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET (or AUTH=none for local regtest).");
  server.listen(C.port, () => console.log(`zcash-faucet server on :${C.port} (${C.network}, auth=${C.auth})`));
  boot().then(sync).catch((e) => console.error("boot failed:", e.message));
  setInterval(sync, C.syncEveryS * 1000);
}
