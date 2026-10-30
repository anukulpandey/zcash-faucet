// The login token must never be reused: foreign tokens are never used, scoped tokens are refused,
// and every token of the faucet's own app is revoked right after the identity check.
import assert from "node:assert";
import { test } from "node:test";
import http from "node:http";
import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const tokens = { good: [], scoped: ["repo"] }; // token -> scopes; anything else is not ours
const calls = [];

test("GitHub tokens are verified, never reused, and revoked", async (t) => {
  const fake = http.createServer(async (req, res) => {
    let body = ""; for await (const c of req) body += c;
    const tok = body ? JSON.parse(body).access_token : req.headers.authorization?.replace("Bearer ", "");
    calls.push(`${req.method} ${req.url} ${tok}`);
    if (req.url === "/applications/cid/token" && req.method === "POST")
      return tokens[tok] ? res.end(JSON.stringify({ scopes: tokens[tok] })) : (res.statusCode = 404, res.end("{}"));
    if (req.url === "/applications/cid/token" && req.method === "DELETE") return (res.statusCode = 204, res.end());
    if (req.url === "/user") return res.end(JSON.stringify({ id: 7, login: "dev", created_at: "2015-01-01T00:00:00Z" }));
    res.statusCode = 404; res.end();
  }).listen(0);
  const port = 19000 + Math.floor(Math.random() * 1000);
  const srv = spawn("node", [join(root, "server/server.js")], {
    env: { ...process.env, PORT: port, GITHUB_CLIENT_ID: "cid", GITHUB_CLIENT_SECRET: "sec", GITHUB_API: `http://127.0.0.1:${fake.address().port}`,
      DATA_DIR: mkdtempSync(join(tmpdir(), "zf-")), WALLET_BIN: join(root, "test/fake-devtool.sh") },
    stdio: "ignore",
  });
  t.after(() => { srv.kill(); fake.close(); });
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 50; i++) { try { if ((await (await fetch(base + "/api/status")).json()).balanceTaz) break; } catch {} await new Promise((r) => setTimeout(r, 100)); }
  const claim = (tok, address) => fetch(base + "/api/claim", { method: "POST", headers: { authorization: `Bearer ${tok}` }, body: JSON.stringify({ address }) });

  assert.equal((await claim("someone-elses-pat", "utest1aaa")).status, 401);
  assert.deepEqual(calls.filter((c) => c.endsWith("someone-elses-pat")), ["POST /applications/cid/token someone-elses-pat"], "foreign token used beyond the ownership check");

  assert.equal((await claim("scoped", "utest1bbb")).status, 401);
  assert.ok(!calls.includes("GET /user scoped"), "scoped token was used");
  assert.ok(calls.includes("DELETE /applications/cid/token scoped"), "scoped token not revoked");

  assert.equal((await claim("good", "utest1ccc")).status, 200);
  const g = calls.filter((c) => c.endsWith(" good"));
  assert.deepEqual(g, ["POST /applications/cid/token good", "GET /user good", "DELETE /applications/cid/token good"]);
});
