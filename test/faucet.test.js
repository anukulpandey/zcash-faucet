// End-to-end: real server + real CLI code, fake wallet binary, AUTH=none.
import assert from "node:assert";
import { test } from "node:test";
import { spawn, execFile } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkAddress } from "../bin/zcash-faucet.js";

const root = new URL("..", import.meta.url).pathname;
const run = (args, env) => new Promise((r) => execFile("node", [join(root, "bin/zcash-faucet.js"), ...args], { env: { ...process.env, ...env } }, (e, out, err) => r({ code: e?.code ?? 0, out: out + err })));

test("CLI address check", () => {
  assert.equal(checkAddress("utest1qqqq"), null);
  assert.equal(checkAddress("tmUiVxo1bbZLP5z6KYfM4dh3PcX5wkd7on8"), null);
  assert.match(checkAddress("u1qj7c2kr4"), /MAINNET/);
  assert.match(checkAddress("hello"), /testnet/);
});

test("claim flow against the server", async (t) => {
  const port = 18000 + Math.floor(Math.random() * 1000);
  const srv = spawn("node", [join(root, "server/server.js")], {
    env: { ...process.env, PORT: port, AUTH: "none", DATA_DIR: mkdtempSync(join(tmpdir(), "zf-")), WALLET_BIN: join(root, "test/fake-devtool.sh") },
    stdio: "inherit",
  });
  t.after(() => srv.kill());
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 50; i++) { try { if ((await (await fetch(base + "/api/status")).json()).balanceTaz) break; } catch {} await new Promise((r) => setTimeout(r, 100)); }
  const env = { ZCASH_FAUCET_URL: base };

  const st = await run(["--status"], env);
  assert.match(st.out, /0\.5 TAZ/);

  const ok = await run(["utest1goodaddress"], env);
  assert.equal(ok.code, 0, ok.out);
  assert.match(ok.out, /ab12cd34/);

  const again = await run(["utest1goodaddress"], env);
  assert.equal(again.code, 1);
  assert.match(again.out, /already got coins today/);

  const fail = await run(["utest1fail"], env);
  assert.match(fail.out, /cooldown was not used/);
  const failStatus = await (await fetch(base + "/api/status")).json();
  assert.equal(failStatus.drips.allTime, 1);

  const mainnet = await fetch(base + "/api/claim", { method: "POST", body: JSON.stringify({ address: "u1abc" }) });
  assert.equal(mainnet.status, 400);

  const donate = await run(["--donate"], env);
  assert.match(donate.out, /utest1fakedonation/);
});
