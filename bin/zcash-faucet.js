#!/usr/bin/env node
// zcash-faucet: request Zcash testnet coins (TAZ) from your terminal.
// Mines a short Argon2id proof-of-work (no account needed), then asks the faucet server to pay.
// --github skips mining by signing in with GitHub's device flow instead.
import { readFileSync, rmSync } from "node:fs";
import { homedir, availableParallelism } from "node:os";
import crypto from "node:crypto";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";

const DEFAULT_FAUCET = "https://zcash-faucet.vercel.app"; // Vercel front, forwards /api to the wallet server; override with --faucet / ZCASH_FAUCET_URL
const { version } = JSON.parse(readFileSync(new URL("../package.json", import.meta.url)));
// v1.0.0 cached the login token here; we no longer store it, and delete it if present.
const OLD_TOKEN_FILE = join(process.env.XDG_CONFIG_HOME || join(homedir(), ".config"), "zcash-faucet", "github-token");

// Mine on every core: libuv's threadpool (4 by default) runs the async Argon2id calls.
process.env.UV_THREADPOOL_SIZE ??= String(Math.min(16, Math.max(4, availableParallelism())));

const tty = process.stdout.isTTY && !process.env.NO_COLOR;
const paint = (code) => (s) => (tty ? `\x1b[${code}m${s}\x1b[0m` : String(s));
const gold = paint("38;5;214"), dim = paint("2"), bold = paint("1"), red = paint("31"), green = paint("32"), cyan = paint("36");

const BANNER = String.raw`
    .-~~~~~~-.
  .'  ______  '.
 /   |___  /    \    ███████╗ ██████╗ █████╗ ███████╗██╗  ██╗
|  ===  / /===   |   ╚══███╔╝██╔════╝██╔══██╗██╔════╝██║  ██║
|      / /       |     ███╔╝ ██║     ███████║███████╗███████║
|  ===/ /____=== |    ███╔╝  ██║     ██╔══██║╚════██║██╔══██║
 \   /______|   /    ███████╗╚██████╗██║  ██║███████║██║  ██║
  '.          .'     ╚══════╝ ╚═════╝╚═╝  ╚═╝╚══════╝╚═╝  ╚═╝
    '-.____.-'         t e s t n e t   ·   f a u c e t
`;

// Cheap local check so typos and mainnet addresses fail before any network call.
export function checkAddress(addr) {
  if (/^(u1|zs1|zc|t1|t3|tex1)/.test(addr)) return "That's a MAINNET address. This faucet pays testnet only (TAZ). Use a testnet address: utest1…, ztestsapling1…, tm…";
  if (/^(utest1|ztestsapling1|tm|textest1|uregtest1|zregtestsapling1)[0-9a-zA-Z]+$/.test(addr)) return null;
  return "Doesn't look like a Zcash testnet address (expected utest1…, ztestsapling1…, tm… or textest1…).";
}

function spinner(text) {
  const frames = "⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏";
  let i = 0, label = text;
  const id = tty ? setInterval(() => process.stdout.write(`\r\x1b[2K${gold(frames[i++ % frames.length])} ${label}`), 80) : null;
  if (!tty) console.log(`… ${text}`);
  return {
    set: (t) => { label = t; },
    stop: (final) => { if (id) clearInterval(id); if (tty) process.stdout.write("\r\x1b[2K"); if (final) console.log(final); },
  };
}

async function http(url, init = {}) {
  let res;
  try {
    res = await fetch(url, { ...init, headers: { accept: "application/json", "content-type": "application/json", "user-agent": `zcash-faucet-cli/${version}`, ...init.headers } });
  } catch (e) {
    throw new Error(`Can't reach ${new URL(url).origin} (${e.cause?.code ?? e.message}). Check your connection, or try --faucet <url>.`);
  }
  const body = await res.json().catch(() => ({ ok: false, error: `HTTP ${res.status} with a non-JSON body.` }));
  return { status: res.status, body };
}

const fmtWait = (s) => (s >= 3600 ? `${Math.ceil(s / 3600)}h` : s >= 60 ? `${Math.ceil(s / 60)}m` : `${s}s`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function openBrowser(url) {
  const cmd = process.platform === "darwin" ? "open" : process.platform === "win32" ? "explorer" : "xdg-open";
  try { spawn(cmd, [url], { stdio: "ignore", detached: true }).on("error", () => {}).unref(); } catch {}
}

// GitHub OAuth device flow: https://docs.github.com/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps#device-flow
// Signs in to the faucet's own OAuth app with NO scopes (public profile only). The token is kept in memory
// for this one request, never written to disk; the server checks your account, then revokes the token.
async function githubLogin(clientId) {
  const { body: dc } = await http("https://github.com/login/device/code", { method: "POST", body: JSON.stringify({ client_id: clientId, scope: "" }) });
  if (!dc.device_code) throw new Error(`GitHub login failed to start: ${dc.error_description ?? dc.error ?? "unknown error"}`);
  console.log(`  ${bold("Sign in with GitHub")} ${dim("(one claim per account per day keeps bots out)")}`);
  console.log(`  ${dim("No permissions requested: the faucet only sees your public username and account age,")}`);
  console.log(`  ${dim("then revokes the login right away. Nothing is saved on this computer.")}\n`);
  console.log(`  1. Open   ${cyan(dc.verification_uri)}`);
  console.log(`  2. Enter  ${bold(gold(dc.user_code))}\n`);
  openBrowser(dc.verification_uri);
  const sp = spinner("Waiting for you to approve in the browser…");
  let interval = (dc.interval ?? 5) * 1000;
  const deadline = Date.now() + (dc.expires_in ?? 900) * 1000;
  while (Date.now() < deadline) {
    await sleep(interval);
    const { body: t } = await http("https://github.com/login/oauth/access_token", {
      method: "POST",
      body: JSON.stringify({ client_id: clientId, device_code: dc.device_code, grant_type: "urn:ietf:params:oauth:grant-type:device_code" }),
    });
    if (t.access_token) {
      sp.stop(`${green("✔")} Signed in with GitHub\n`);
      return t.access_token;
    }
    if (t.error === "slow_down") interval += 5000;
    else if (t.error !== "authorization_pending") { sp.stop(); throw new Error(`GitHub login failed: ${t.error_description ?? t.error}`); }
  }
  sp.stop();
  throw new Error("GitHub login timed out. Run the command again.");
}

async function getStatus(base) {
  const { body } = await http(`${base}/api/status`);
  if (!body.ok) throw new Error(body.error ?? "Faucet status unavailable.");
  return body;
}

async function showStatus(base) {
  const s = await getStatus(base);
  const row = (k, v) => console.log(`  ${dim(k.padEnd(10))} ${v}`);
  console.log(bold(`  Faucet status · ${base}\n`));
  row("health", s.healthy ? green("● online") : red(`● degraded${s.lastSyncError ? ` (${s.lastSyncError})` : ""}`));
  row("network", s.network);
  row("balance", s.balanceTaz == null ? dim("syncing…") : `${s.balanceTaz} TAZ ${dim(`(${s.spendableTaz} spendable)`)}`);
  row("drip", `${s.dripTaz} TAZ every ${fmtWait(s.cooldownSeconds)}`);
  row("gate", s.auth === "pow" ? `Argon2id proof-of-work${s.githubClientId ? " · or --github" : ""}` : s.auth);
  row("drips", `${s.drips.last24h} last 24h · ${s.drips.allTime} all-time`);
  row("height", s.height ?? "?");
  console.log(`\n  ${dim("Donate leftover TAZ:")} npx zcash-faucet --donate`);
}

async function showDonate(base) {
  const s = await getStatus(base);
  console.log(`  ${bold("Send leftover TAZ back so the next dev gets some:")}\n\n  ${cyan(s.donationAddress ?? "address not available yet")}\n`);
}

export const zeroBits = (buf) => { let n = 0; for (const b of buf) { if (b) return n + Math.clz32(b) - 24; n += 8; } return n; };

// Find a nonce where argon2id(message=nonce, salt=seed) starts with `difficulty` zero bits.
// Memory-hard (19 MiB per hash), so a GPU or bot farm gains little over your laptop.
export async function mine({ seed, difficulty, params }, onProgress = () => {}) {
  if (typeof crypto.argon2 !== "function") throw new Error(`Proof-of-work needs Node 24.7 or newer (you have ${process.version}). Upgrade Node, or use --github.`);
  const salt = Buffer.from(seed, "hex");
  let next = 0, found = null;
  const t0 = Date.now();
  const worker = async () => {
    while (found === null) {
      const nonce = next++;
      const tag = await new Promise((ok, fail) => crypto.argon2("argon2id", { ...params, message: String(nonce), nonce: salt }, (e, b) => (e ? fail(e) : ok(b))));
      if (found === null && zeroBits(tag) >= difficulty) found = String(nonce);
      if (nonce % 64 === 0) onProgress(next, Date.now() - t0);
    }
  };
  await Promise.all(Array.from({ length: +process.env.UV_THREADPOOL_SIZE || 4 }, worker));
  return { nonce: found, hashes: next, ms: Date.now() - t0 };
}

async function claim(base, address, useGithub) {
  const s = await getStatus(base);
  const body = { address };
  let token = null;
  if (s.auth === "none") {
    // local regtest faucet: no gate
  } else if (useGithub) {
    if (!s.githubClientId) throw new Error("This faucet doesn't offer GitHub login. Drop --github to use proof-of-work.");
    token = await githubLogin(s.githubClientId);
  } else {
    const ch = await http(`${base}/api/challenge?address=${encodeURIComponent(address)}`);
    if (!ch.body.ok) {
      const wait = ch.body.retryAfterSeconds ? dim(` (try again in ~${fmtWait(ch.body.retryAfterSeconds)})`) : "";
      throw new Error(`${ch.body.error ?? `Faucet refused (HTTP ${ch.status}).`}${wait}`);
    }
    const expected = 2 ** ch.body.difficulty;
    const label = (h, ms) => `Mining proof-of-work · ${Math.min(99, Math.round((h / expected) * 100))}% of expected · ${h.toLocaleString()} hashes · ${(ms / 1000).toFixed(0)}s`;
    const sp = spinner(`Mining proof-of-work (Argon2id, difficulty ${ch.body.difficulty}, usually under a minute)…`);
    const pow = await mine(ch.body, (h, ms) => sp.set(label(h, ms)));
    sp.stop(`${green("✔")} Proof-of-work done ${dim(`(${pow.hashes.toLocaleString()} hashes in ${(pow.ms / 1000).toFixed(1)}s, no account needed)`)}`);
    body.pow = { seed: ch.body.seed, difficulty: ch.body.difficulty, exp: ch.body.exp, sig: ch.body.sig, nonce: pow.nonce };
  }
  const sp = spinner(`Sending ${s.dripTaz} TAZ (building a shielded transaction takes ~10-60s)…`);
  const r = await http(`${base}/api/claim`, {
    method: "POST",
    headers: token ? { authorization: `Bearer ${token}` } : {},
    body: JSON.stringify(body),
  });
  sp.stop();
  if (!r.body.ok) {
    const wait = r.body.retryAfterSeconds ? dim(` (try again in ~${fmtWait(r.body.retryAfterSeconds)})`) : "";
    throw new Error(`${r.body.error ?? `Faucet refused (HTTP ${r.status}).`}${wait}`);
  }
  const b = r.body;
  console.log(`\n  ${gold("ⓩ")}  ${bold(green(`${b.amountTaz} TAZ`))} on its way to ${cyan(address.slice(0, 14) + "…" + address.slice(-6))}\n`);
  if (b.txid) console.log(`  ${dim("txid")}      ${b.txid}`);
  if (b.explorerUrl) console.log(`  ${dim("explorer")}  ${cyan(b.explorerUrl)}`);
  console.log(`\n  ${dim("Arrives after ~1 block (75s). Done testing? Give it back: npx zcash-faucet --donate")}`);
}

const HELP = `
  ${bold("Usage")}
    npx zcash-faucet <testnet-address>   request TAZ (mines a short proof-of-work, no account)
    npx zcash-faucet --status            faucet health, balance, drip size
    npx zcash-faucet --donate            address to send leftover TAZ back to

  ${bold("Options")}
    --github         sign in with GitHub instead of mining (no permissions, revoked after use)
    --faucet <url>   use another zcash-faucet server, e.g. your local regtest one
                     (default ${DEFAULT_FAUCET}, or set ZCASH_FAUCET_URL)
    -h, --help       show this help
    -v, --version    print version
`;

async function main(argv) {
  rmSync(OLD_TOKEN_FILE, { force: true });
  const args = [...argv];
  const fi = args.indexOf("--faucet");
  const base = (fi >= 0 ? args.splice(fi, 2)[1] : process.env.ZCASH_FAUCET_URL || DEFAULT_FAUCET)?.replace(/\/+$/, "");
  if (args.includes("-v") || args.includes("--version")) return console.log(version);
  console.log(gold(BANNER));
  if (!base) throw new Error("--faucet needs a URL.");
  if (args.includes("--status")) return showStatus(base);
  if (args.includes("--donate")) return showDonate(base);
  const address = args.find((a) => !a.startsWith("-"))?.trim();
  if (!address || args.includes("-h") || args.includes("--help")) return console.log(HELP);
  const bad = checkAddress(address);
  if (bad) throw new Error(bad);
  await claim(base, address, args.includes("--github"));
}

if (process.argv[1] && (import.meta.url === pathToFileURL(process.argv[1]).href || process.argv[1].endsWith("zcash-faucet"))) {
  main(process.argv.slice(2)).catch((e) => {
    console.error(`\n  ${red("✖")} ${e.message}\n`);
    process.exit(1);
  });
}
