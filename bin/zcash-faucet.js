#!/usr/bin/env node
// zcash-faucet: request Zcash testnet coins (TAZ) from your terminal.
// Signs you in with GitHub (device flow, like `gh auth login`), then asks the faucet server to pay.
import { readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";

const DEFAULT_FAUCET = "https://zcash-faucet.onrender.com"; // override with --faucet / ZCASH_FAUCET_URL
const { version } = JSON.parse(readFileSync(new URL("../package.json", import.meta.url)));
const TOKEN_FILE = join(process.env.XDG_CONFIG_HOME || join(homedir(), ".config"), "zcash-faucet", "github-token");

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
async function githubLogin(clientId) {
  const { body: dc } = await http("https://github.com/login/device/code", { method: "POST", body: JSON.stringify({ client_id: clientId, scope: "" }) });
  if (!dc.device_code) throw new Error(`GitHub login failed to start: ${dc.error_description ?? dc.error ?? "unknown error"}`);
  console.log(`  ${bold("Sign in with GitHub")} ${dim("(one per day per account keeps bots out)")}\n`);
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
      mkdirSync(join(TOKEN_FILE, ".."), { recursive: true });
      writeFileSync(TOKEN_FILE, t.access_token, { mode: 0o600 });
      return t.access_token;
    }
    if (t.error === "slow_down") interval += 5000;
    else if (t.error !== "authorization_pending") { sp.stop(); throw new Error(`GitHub login failed: ${t.error_description ?? t.error}`); }
  }
  sp.stop();
  throw new Error("GitHub login timed out. Run the command again.");
}

const savedToken = () => { try { return readFileSync(TOKEN_FILE, "utf8").trim(); } catch { return null; } };

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
  row("drips", `${s.drips.last24h} last 24h · ${s.drips.allTime} all-time`);
  row("height", s.height ?? "?");
  console.log(`\n  ${dim("Donate leftover TAZ:")} npx zcash-faucet --donate`);
}

async function showDonate(base) {
  const s = await getStatus(base);
  console.log(`  ${bold("Send leftover TAZ back so the next dev gets some:")}\n\n  ${cyan(s.donationAddress ?? "address not available yet")}\n`);
}

async function claim(base, address) {
  const s = await getStatus(base);
  let token = null;
  if (s.auth === "github") {
    token = savedToken() ?? (await githubLogin(s.githubClientId));
  }
  for (let attempt = 0; ; attempt++) {
    const sp = spinner(`Sending ${s.dripTaz} TAZ (building a shielded transaction takes ~10-30s)…`);
    const r = await http(`${base}/api/claim`, {
      method: "POST",
      headers: token ? { authorization: `Bearer ${token}` } : {},
      body: JSON.stringify({ address }),
    });
    sp.stop();
    if (r.body.needLogin && attempt === 0 && s.auth === "github") {
      rmSync(TOKEN_FILE, { force: true });
      token = await githubLogin(s.githubClientId);
      continue;
    }
    if (!r.body.ok) {
      const wait = r.body.retryAfterSeconds ? dim(` (try again in ~${fmtWait(r.body.retryAfterSeconds)})`) : "";
      throw new Error(`${r.body.error ?? `Faucet refused (HTTP ${r.status}).`}${wait}`);
    }
    const b = r.body;
    console.log(`\n  ${gold("ⓩ")}  ${bold(green(`${b.amountTaz} TAZ`))} on its way to ${cyan(address.slice(0, 14) + "…" + address.slice(-6))}\n`);
    if (b.txid) console.log(`  ${dim("txid")}      ${b.txid}`);
    if (b.explorerUrl) console.log(`  ${dim("explorer")}  ${cyan(b.explorerUrl)}`);
    console.log(`\n  ${dim("Arrives after ~1 block (75s). Done testing? Give it back: npx zcash-faucet --donate")}`);
    return;
  }
}

const HELP = `
  ${bold("Usage")}
    npx zcash-faucet <testnet-address>   request TAZ (signs in with GitHub once)
    npx zcash-faucet --status            faucet health, balance, drip size
    npx zcash-faucet --donate            address to send leftover TAZ back to
    npx zcash-faucet --logout            forget the saved GitHub login

  ${bold("Options")}
    --faucet <url>   use another zcash-faucet server, e.g. your local regtest one
                     (default ${DEFAULT_FAUCET}, or set ZCASH_FAUCET_URL)
    -h, --help       show this help
    -v, --version    print version
`;

async function main(argv) {
  const args = [...argv];
  const fi = args.indexOf("--faucet");
  const base = (fi >= 0 ? args.splice(fi, 2)[1] : process.env.ZCASH_FAUCET_URL || DEFAULT_FAUCET)?.replace(/\/+$/, "");
  if (args.includes("-v") || args.includes("--version")) return console.log(version);
  console.log(gold(BANNER));
  if (!base) throw new Error("--faucet needs a URL.");
  if (args.includes("--logout")) { rmSync(TOKEN_FILE, { force: true }); return console.log(`  ${green("✔")} Logged out.`); }
  if (args.includes("--status")) return showStatus(base);
  if (args.includes("--donate")) return showDonate(base);
  const address = args.find((a) => !a.startsWith("-"))?.trim();
  if (!address || args.includes("-h") || args.includes("--help")) return console.log(HELP);
  const bad = checkAddress(address);
  if (bad) throw new Error(bad);
  await claim(base, address);
}

if (process.argv[1] && (import.meta.url === pathToFileURL(process.argv[1]).href || process.argv[1].endsWith("zcash-faucet"))) {
  main(process.argv.slice(2)).catch((e) => {
    console.error(`\n  ${red("✖")} ${e.message}\n`);
    process.exit(1);
  });
}
