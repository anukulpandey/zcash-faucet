<div align="center">

<img width="545" height="292" alt="Screenshot 2026-10-31 at 2 36 36 AM" src="https://github.com/user-attachments/assets/ad18660a-c49c-4436-990a-238344ee693a" />

**Zcash testnet coins (TAZ), straight to your terminal.**

[![npm](https://img.shields.io/npm/v/zcash-faucet?color=f4b728&label=npm)](https://www.npmjs.com/package/zcash-faucet)
![node](https://img.shields.io/badge/node-%3E%3D18-339933)
![deps](https://img.shields.io/badge/dependencies-0-brightgreen)
![network](https://img.shields.io/badge/network-testnet%20only-f4b728)
[![uptime](https://github.com/anukulpandey/zcash-faucet/actions/workflows/uptime.yml/badge.svg)](https://github.com/anukulpandey/zcash-faucet/actions/workflows/uptime.yml)
[![license](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

</div>

```bash
npx zcash-faucet utest1your_testnet_address...
```

One command. Sign in with GitHub once, and TAZ arrives at your **unified, Sapling or transparent** testnet address.

---

## ✨ What it looks like

```
  Sign in with GitHub (one per day per account keeps bots out)

  1. Open   https://github.com/login/device
  2. Enter  ABCD-1234

  ✔ Signed in with GitHub

  ⓩ  0.1 TAZ on its way to utest17rnhex9h…2dd5rk

  txid      ab12cd34…
  explorer  https://testnet.zcashexplorer.app/transactions/ab12cd34…

  Arrives after ~1 block (75s). Done testing? Give it back: npx zcash-faucet --donate
```

## 🚀 Usage

```bash
npx zcash-faucet <testnet-address>    # request TAZ
npx zcash-faucet --status             # health, balance, drip size, recent drips
npx zcash-faucet --donate             # where to send leftover TAZ
npx zcash-faucet --logout             # forget the saved GitHub login
```

| Option | What it does |
| --- | --- |
| `--faucet <url>` | Use another zcash-faucet server, such as your local regtest one (or set `ZCASH_FAUCET_URL`) |
| `NO_COLOR=1` | Turn off colors |

**Accepted addresses:** `utest1…` (unified), `ztestsapling1…` (Sapling), `tm…` (transparent), `textest1…` (TEX).
Mainnet addresses are rejected before anything is sent.

## 🛡 Why this faucet stays up

Most Zcash faucets died from bots draining them. This one is built so that doesn't happen:

| Problem | What zcash-faucet does |
| --- | --- |
| Bots drain the wallet | **GitHub login** (device flow, no password ever touches the CLI). One claim per GitHub account **and** per address every 24h. Accounts younger than 30 days are refused. |
| Per-IP limits block whole classrooms | **No IP limits.** 40 students on one campus Wi-Fi can all claim. |
| Big payouts empty it fast | Modest drips (0.1 TAZ) and a global daily cap. |
| Nobody notices when it breaks | Public [status page](#-status--donations) plus a GitHub Actions monitor every 5 minutes that opens an issue on outage or low balance. |
| It runs dry | `npx zcash-faucet --donate` prints the address to send leftovers back to. |

## 🧠 How it works

```
  npx zcash-faucet utest1…
          │
          │ 1. GitHub device login (token cached in ~/.config/zcash-faucet)
          ▼
  ┌──────────────────────┐   POST /api/claim     ┌───────────────────────────┐
  │  CLI (this package)  │ ────────────────────▶ │  faucet server (Node)     │
  │  zero dependencies   │ ◀── txid ──────────── │  • verifies GitHub user   │
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

- `npx zcash-faucet --status`, or open the faucet URL in a browser for the status page
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
DOMAIN=$(curl -s ifconfig.me).sslip.io GITHUB_CLIENT_ID=<your OAuth app id> docker compose up -d
docker compose logs faucet   # prints the faucet address: fund it with TAZ
```

On Google Cloud's free tier, one command creates the VM, static IP and firewall: `PROJECT=<id> GITHUB_CLIENT_ID=<id> sh deploy/gcp.sh`

1. Create a GitHub OAuth App (Settings → Developer settings → OAuth Apps) and **tick "Enable Device Flow"**. Only the Client ID is needed.
2. Caddy gets a TLS certificate automatically. `sslip.io` gives you a free hostname for your IP.
3. **Back up the seed:** `docker compose exec faucet zcash-devtool wallet -w /data/wallet display-mnemonic --enable -i /data/identity.txt`

| Env var | Default | Meaning |
| --- | --- | --- |
| `GITHUB_CLIENT_ID` | (required) | OAuth app for device login |
| `DRIP_ZAT` | `10000000` | Payout per claim (0.1 TAZ) |
| `DAILY_CAP_ZAT` | `500000000` | Max paid out per 24h (5 TAZ) |
| `COOLDOWN_HOURS` | `24` | Per account and per address |
| `MIN_GITHUB_AGE_DAYS` | `30` | Reject newer GitHub accounts |
| `NETWORK` / `LWD_SERVER` | `test` / `zecrocks` | `regtest` + `host:port` for local |
| `AUTH` | `github` | `none` for local regtest only |

## 🛠 Development

```bash
npm test                       # CLI + server end to end, with a fake wallet binary
node bin/zcash-faucet.js --help
```

Publishing: `npm login` once, then `npm version patch && npm publish && git push --follow-tags`.

## ⚠️ Testnet only

TAZ has **no monetary value**. Never send it to a mainnet address, and never reuse a testnet key for real funds.

MIT © anukulpandey · built on [zcash-devtool](https://github.com/zcash/zcash-devtool) and [zec.rocks](https://zec.rocks)
