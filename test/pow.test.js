// Default gate: Argon2id proof-of-work. A proof pays once, only for its own address, at the issued difficulty.
import assert from "node:assert";
import { test } from "node:test";
import { spawn, execFile } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mine } from "../bin/zcash-faucet.js";

const root = new URL("..", import.meta.url).pathname;
const cli = (args, env) => new Promise((r) => execFile("node", [join(root, "bin/zcash-faucet.js"), ...args], { env: { ...process.env, ...env } }, (e, out, err) => r({ code: e?.code ?? 0, out: out + err })));

test("proof-of-work claims", async (t) => {
  const port = 20000 + Math.floor(Math.random() * 1000);
  const srv = spawn("node", [join(root, "server/server.js")], {
    env: { ...process.env, PORT: port, POW_DIFFICULTY: 4, DATA_DIR: mkdtempSync(join(tmpdir(), "zf-")), WALLET_BIN: join(root, "test/fake-devtool.sh") },
    stdio: "ignore",
  });
  t.after(() => srv.kill());
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 50; i++) { try { if ((await (await fetch(base + "/api/status")).json()).balanceTaz) break; } catch {} await new Promise((r) => setTimeout(r, 100)); }
  const challenge = async (a) => (await fetch(`${base}/api/challenge?address=${a}`)).json();
  const claim = async (address, pow) => (await fetch(base + "/api/claim", { method: "POST", body: JSON.stringify({ address, pow }) })).json();
  const solved = async (a) => { const c = await challenge(a); const { nonce } = await mine(c); return { seed: c.seed, difficulty: c.difficulty, exp: c.exp, sig: c.sig, nonce }; };

  // the real CLI mines and gets paid, no login
  const ok = await cli(["utest1powclaim"], { ZCASH_FAUCET_URL: base });
  assert.equal(ok.code, 0, ok.out);
  assert.match(ok.out, /Proof-of-work done/);
  assert.match(ok.out, /ab12cd34/);

  assert.match((await claim("utest1nopow")).error, /Missing proof-of-work/);

  const p = await solved("utest1aaa");
  assert.match((await claim("utest1bbb", p)).error, /Invalid proof-of-work challenge/, "proof moved to another address");
  assert.match((await claim("utest1aaa", { ...p, difficulty: 0 })).error, /Invalid proof-of-work challenge/, "difficulty tampered");
  assert.equal((await claim("utest1aaa", p)).ok, true);
  const p2 = await solved("utest1aaa");
  assert.equal((await claim("utest1aaa", p2)).ok, true, "second claim inside the window");
  const again = await solved("utest1ccc");
  assert.equal((await claim("utest1ccc", again)).ok, true);
  assert.match((await claim("utest1ccc", again)).error, /already got coins|already used/, "proof replayed");

  // a failed send gives the cooldown back, but the proof stays spent
  const f = await solved("utest1fail");
  assert.match((await claim("utest1fail", f)).error, /Send failed/);
  assert.match((await claim("utest1fail", f)).error, /already used/);

  // an address on cooldown is refused before anyone mines
  assert.match((await challenge("utest1aaa")).error, /already got coins 2 times today/);
});
