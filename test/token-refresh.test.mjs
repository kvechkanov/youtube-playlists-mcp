import assert from "node:assert/strict";
import fs from "node:fs";
import { after, before, test } from "node:test";
import { connectServer, futureExpiry, sandbox, startMock, writeToken } from "./helpers/harness.mjs";

const unauthorized = {
  status: 401,
  body: { error: { code: 401, message: "Invalid Credentials", errors: [{ reason: "authError" }] } },
};
let mock;
let tokenSeq = 0;

before(async () => {
  mock = await startMock({
    "/token": () => ({
      status: 200,
      body: { access_token: `fresh-${++tokenSeq}`, expires_in: 3600 },
    }),
    "/playlists": () => {
      const last = mock.requests.at(-1);
      return last.auth === "Bearer REVOKED" ? unauthorized : { status: 200, body: { items: [] } };
    },
    "/playlistItems": () => unauthorized,
  });
});
after(() => mock.close());

test("a 401 refreshes the access token once and retries the call", async () => {
  const sb = sandbox(mock);
  writeToken(sb, { refresh_token: "rt", access_token: "REVOKED", expires_at: futureExpiry() });
  const server = await connectServer(sb);
  const before = mock.requests.length;
  const r = await server.call("list_my_playlists");
  await server.close();
  assert.equal(r.isError, false, r.text);
  const sent = mock.requests.slice(before);
  assert.deepEqual(
    sent.map((q) => q.path),
    ["/playlists", "/token", "/playlists"],
  );
  assert.equal(sent[0].auth, "Bearer REVOKED");
  assert.match(sent[2].auth, /^Bearer fresh-/);
  assert.match(JSON.parse(fs.readFileSync(sb.tokenFile, "utf8")).access_token, /^fresh-/);
});

test("a 401 that persists after the refresh is reported, with one retry only", async () => {
  const sb = sandbox(mock);
  writeToken(sb, { refresh_token: "rt", access_token: "at", expires_at: futureExpiry() });
  const server = await connectServer(sb);
  const before = mock.requests.length;
  const r = await server.call("list_playlist_items", { playlistId: "PLabc" });
  await server.close();
  assert.equal(r.isError, true);
  assert.match(r.text, /401/);
  assert.equal(mock.requests.slice(before).filter((q) => q.path === "/playlistItems").length, 2);
  assert.equal(mock.requests.slice(before).filter((q) => q.path === "/token").length, 1);
});
