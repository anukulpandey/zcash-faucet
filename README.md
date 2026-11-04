<div align="center">

<img width="545" height="292" alt="Screenshot 2026-10-31 at 2 36 36 AM" src="https://github.com/user-attachments/assets/ad18660a-c49c-4436-990a-238344ee693a" />

**Zcash testnet coins (TAZ), straight to your terminal.**

[![npm](https://img.shields.io/npm/v/zcash-faucet?color=f4b728&label=npm)](https://www.npmjs.com/package/zcash-faucet)
![node](https://img.shields.io/badge/node-%3E%3D24.7-339933)
![deps](https://img.shields.io/badge/dependencies-0-brightgreen)
![network](https://img.shields.io/badge/network-testnet%20only-f4b728)
[![uptime](https://github.com/anukulpandey/zcash-faucet/actions/workflows/uptime.yml/badge.svg)](https://github.com/anukulpandey/zcash-faucet/actions/workflows/uptime.yml)
[![license](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

</div>

```bash
npx zcash-faucet utest1your_testnet_address...
```

One command, **no account**. Your machine mines a short proof-of-work, and TAZ arrives at your **unified, Sapling or transparent** testnet address.

---

## ✨ What it looks like

![zcash-faucet demo: a real claim](docs/demo.gif)

```
  ✔ Proof-of-work done (3,912 hashes in 13.8s, no account needed)

  ⓩ  0.1 TAZ on its way to utest17rnhex9h…2dd5rk

  txid      ab12cd34…
  explorer  https://testnet.zcashexplorer.app/transactions/ab12cd34…

  Arrives after ~1 block (75s). Done testing? Give it back: npx zcash-faucet --donate
```

## 🚀 Usage

```bash
npx zcash-faucet <testnet-address>    # request TAZ (mines ~10-60s, no account)
npx zcash-faucet <address> --github   # skip mining: sign in with GitHub instead
npx zcash-faucet --status             # health, balance, drip size, recent drips
npx zcash-faucet --donate             # where to send leftover TAZ
```

| Option | What it does |
| --- | --- |
| `--github` | Sign in with GitHub instead of mining. No permissions requested; the login is revoked right after the check |
| `--faucet <url>` | Use another zcash-faucet server, such as your local regtest one (or set `ZCASH_FAUCET_URL`) |
| `NO_COLOR=1` | Turn off colors |

**Accepted addresses:** `utest1…` (unified), `ztestsapling1…` (Sapling), `tm…` (transparent), `textest1…` (TEX).
Mainnet addresses are rejected before anything is sent.

**Needs Node 24.7+** for proof-of-work (it uses Node's built-in Argon2id). On older Node, `--github` and `--status` still work.

## 🛡 Why this faucet stays up

Most Zcash faucets died from bots draining them. This one is built so that doesn't happen:

| Problem | What zcash-faucet does |
| --- | --- |
| Bots drain the wallet | **Argon2id proof-of-work**, no account needed. It's memory-hard (19 MiB per hash), so GPUs and bot farms gain little over a laptop. Each proof is signed for one address, pays once, and gets harder when claims spike. Two claims per address every 24h. |
| Identity shouldn't be required | No login by default. `--github` is an optional fast lane: no scopes, token revoked right after the check. |
| Per-IP limits block whole classrooms | **No IP limits.** 40 students on one campus Wi-Fi can all claim. |
| Big payouts empty it fast | Modest drips (0.1 TAZ) and a global daily cap. |
| Nobody notices when it breaks | Public [status page](#-status--donations) plus a GitHub Actions monitor every 5 minutes that opens an issue on outage or low balance. |
| It runs dry | `npx zcash-faucet --donate` prints the address to send leftovers back to. |

## 🧠 How it works

```
  npx zcash-faucet utest1…
          │
          │ 1. mine an Argon2id proof for a signed, single-use challenge
          ▼
  ┌──────────────────────┐   POST /api/claim     ┌───────────────────────────┐
  │  CLI (this package)  │ ────────────────────▶ │  faucet server (Node)     │
  │  zero dependencies   │ ◀── txid ──────────── │  • verifies the proof     │
  └──────────────────────┘                       │  • cooldown + daily cap   │
                                                 │  • one send at a time     │
                                                 └────────────┬──────────────┘
                                                              │ zcash-devtool wallet send
                                                              ▼
                                                 ┌───────────────────────────┐
                                                 │ lightwalletd              │
                                                 │ (testnet.zec.rocks)       │──▶ Zcash testnet
                                                 └───────────────────────────┘
```

The server wraps [zcash-devtool](https://github.com/zcash/zcash-devtool), the Zcash team's developer wallet, which talks to a public lightwalletd. No full node to sync or babysit. The server is one file using only the Node standard library.

## 📊 Status & donations

- Live status page: **https://zcash-faucet.vercel.app** (or `npx zcash-faucet --status`)
- JSON for your own dashboards: `GET /api/status`
- Done testing? Send leftover TAZ back: `npx zcash-faucet --donate`

## 👛 Don't have a testnet address yet?

- **[zcash-devtool](https://github.com/zcash/zcash-devtool)**: `wallet init … -n test`, then `wallet list-addresses` (see its [walkthrough](https://github.com/zcash/zcash-devtool/blob/main/doc/walkthrough.md))
- **[zingo-cli](https://github.com/zingolabs/zingolib)**: start it with `--chain testnet`, then run `addresses`
- **Zallet / zcashd** on testnet: `z_getnewaccount` → `z_getaddressforaccount`

## 🧪 Local regtest

Don't want to depend on anyone's faucet, including this one? Run the same server against your own regtest network with `AUTH=none`. See [deploy/regtest.md](deploy/regtest.md).

## 🏗 Run your own faucet

```bash
# on any Linux box with Docker and a public IP
git clone https://github.com/anukulpandey/zcash-faucet && cd zcash-faucet/deploy
DOMAIN=$(curl -s ifconfig.me).sslip.io docker compose up -d
docker compose logs faucet   # prints the faucet address: fund it with TAZ
```

On Google Cloud's free tier, one command creates the VM, static IP and firewall: `PROJECT=<id> sh deploy/gcp.sh`

1. Optional `--github` fast lane: create a GitHub OAuth App (Settings → Developer settings → OAuth Apps), **tick "Enable Device Flow"**, and set `GITHUB_CLIENT_ID` + `GITHUB_CLIENT_SECRET`.
2. Caddy gets a TLS certificate automatically. `sslip.io` gives you a free hostname for your IP.
3. **Back up the seed:** `docker compose exec faucet zcash-devtool wallet -w /data/wallet display-mnemonic --enable -i /data/identity.txt`

| Env var | Default | Meaning |
| --- | --- | --- |
| `POW_DIFFICULTY` | `12` | Base proof-of-work bits (~4k Argon2id hashes); +1 per doubling past 10 claims/hour |
| `POW_SECRET` | random | Signs challenges; set it so challenges survive a restart |
| `GITHUB_CLIENT_ID` | (unset) | Optional: enables `--github` |
| `GITHUB_CLIENT_SECRET` | (unset) | Required with the ID: lets the server verify and revoke each login token |
| `DRIP_ZAT` | `10000000` | Payout per claim (0.1 TAZ) |
| `DAILY_CAP_ZAT` | `500000000` | Max paid out per 24h (5 TAZ) |
| `COOLDOWN_HOURS` | `24` | Window for the per-address (and per-GitHub) claim limit |
| `CLAIMS_PER_WINDOW` | `2` | Claims allowed inside that window |
| `MIN_GITHUB_AGE_DAYS` | `30` | Reject newer GitHub accounts |
| `NETWORK` / `LWD_SERVER` | `test` / `zecrocks` | `regtest` + `host:port` for local |
| `AUTH` | `pow` | `none` for local regtest only |

## 🛠 Development

```bash
npm test                       # CLI + server end to end, with a fake wallet binary
node bin/zcash-faucet.js --help
```

Publishing: `npm login` once, then `npm version patch && npm publish && git push --follow-tags`.

## 🔒 Security & privacy

**By default there is no login at all.** The CLI mines an Argon2id proof-of-work; the server sees only the address you ask it to pay.

**With `--github`** (optional), the login only replaces mining. Here is exactly what happens:

1. The CLI runs GitHub's [device flow](https://docs.github.com/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps#device-flow) for **the faucet's own OAuth app**, requesting **no scopes**. A no-scope token can only read public profile data: no repos, no email, no private anything. GitHub shows you this on the approval screen.
2. The CLI **never reads any existing credential** (not `gh`, git or your browser), and **never writes the token to disk**. It lives in memory for one request. (v1.0.0 cached it; v1.1.0+ deletes that old file on every run.)
3. The server first asks GitHub whether the token belongs to this faucet's app and carries no scopes. **Any other token is refused without being used.**
4. It reads your public user ID and account creation date (`GET /user`), then **immediately revokes the token** through GitHub's API, so it can never be reused, even by whoever runs the server.
5. Only your numeric GitHub ID and the claim times are stored, for the 24h window.

The whole flow is about 40 lines: [`githubLogin` in the CLI](bin/zcash-faucet.js) and [`githubUser` / `revoke` on the server](server/server.js), with a test in [test/github-auth.test.js](test/github-auth.test.js). You can also revoke the app any time at github.com/settings/applications. Found a problem? Please open an issue.

## ⚠️ Testnet only

TAZ has **no monetary value**. Never send it to a mainnet address, and never reuse a testnet key for real funds.

MIT © anukulpandey · built on [zcash-devtool](https://github.com/zcash/zcash-devtool) and [zec.rocks](https://zec.rocks)
