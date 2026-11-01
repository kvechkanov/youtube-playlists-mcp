import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, before, test } from "node:test";
import { connectServer, futureExpiry, sandbox, startMock, writeToken } from "./helpers/harness.mjs";

const html502 = { status: 502, type: "text/html", raw: "<html>Bad Gateway</html>" };
const oneVideo = {
  status: 200,
  body: { items: [{ id: { videoId: "dQw4w9WgXcQ" }, snippet: { title: "t" } }] },
};
let mock;
let tokenStatus = 200;

before(async () => {
  mock = await startMock({
    "/playlists": () => html502,
    "/search": () => oneVideo,
    "/token": () =>
      tokenStatus === 200
        ? { status: 200, body: { access_token: "fresh", expires_in: 3600 } }
        : html502,
  });
});
after(() => mock.close());

async function withServer(sb, fn) {
  const server = await connectServer(sb);
  try {
    return await fn(server);
  } finally {
    await server.close();
  }
}

test("a corrupt token file says to re-run auth and names the file", async () => {
  const sb = sandbox(mock);
  fs.writeFileSync(sb.tokenFile, '{"refresh_tok');
  const r = await withServer(sb, (s) => s.call("list_my_playlists"));
  assert.equal(r.isError, true);
  assert.match(r.text, /NOT AUTHORIZED/);
  assert.ok(r.text.includes(sb.tokenFile), r.text);
  assert.match(r.text, /auth/i);
});

test("a corrupt search cache is discarded and the search still works", async () => {
  const sb = sandbox(mock);
  writeToken(sb, { refresh_token: "rt", access_token: "at", expires_at: futureExpiry() });
  fs.writeFileSync(sb.cacheFile, '{"[\\"rust');
  const r = await withServer(sb, (s) => s.call("search_videos", { query: "rust" }));
  assert.equal(r.isError, false, r.text);
  assert.equal(JSON.parse(r.text).results[0].videoId, "dQw4w9WgXcQ");
  assert.doesNotThrow(() => JSON.parse(fs.readFileSync(sb.cacheFile, "utf8")));
});

test("a non-JSON API response reports the HTTP status, not a parse error", async () => {
  const sb = sandbox(mock);
  writeToken(sb, { refresh_token: "rt", access_token: "at", expires_at: futureExpiry() });
  const r = await withServer(sb, (s) => s.call("list_my_playlists"));
  assert.equal(r.isError, true);
  assert.match(r.text, /502/);
  assert.doesNotMatch(r.text, /JSON at position|Unexpected token/);
});

test("a non-JSON token endpoint response reports the HTTP status", async () => {
  const sb = sandbox(mock);
  writeToken(sb, { refresh_token: "rt" });
  tokenStatus = 502;
  const r = await withServer(sb, (s) => s.call("list_my_playlists"));
  tokenStatus = 200;
  assert.equal(r.isError, true);
  assert.match(r.text, /502/);
  assert.doesNotMatch(r.text, /JSON at position|Unexpected token/);
});

test("a refreshed token is written as an owner-only file with no temp files left", async () => {
  const sb = sandbox(mock);
  writeToken(sb, { refresh_token: "rt" });
  await withServer(sb, (s) => s.call("list_my_playlists"));
  const stored = JSON.parse(fs.readFileSync(sb.tokenFile, "utf8"));
  assert.equal(stored.access_token, "fresh");
  assert.equal(fs.statSync(sb.tokenFile).mode & 0o777, 0o600);
  assert.deepEqual(
    fs.readdirSync(path.dirname(sb.tokenFile)).filter((f) => f.endsWith(".tmp")),
    [],
  );
});
