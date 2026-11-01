import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, before, test } from "node:test";
import { connectServer, futureExpiry, sandbox, startMock } from "./helpers/harness.mjs";

let mock;
before(async () => {
  mock = await startMock({ "/playlists": () => ({ status: 200, body: { items: [] } }) });
});
after(() => mock.close());

function writeAt(file, accessToken) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(
    file,
    JSON.stringify({ refresh_token: "rt", access_token: accessToken, expires_at: futureExpiry() }),
  );
}

async function tokenUsedBy(sb) {
  const server = await connectServer(sb);
  const before = mock.requests.length;
  const r = await server.call("list_my_playlists");
  await server.close();
  assert.equal(r.isError, false, r.text);
  return mock.requests[before].auth;
}

test("a token stored under the pre-rename directory keeps working", async () => {
  const sb = sandbox(mock);
  writeAt(sb.legacyTokenFile, "legacy-at");
  assert.equal(await tokenUsedBy(sb), "Bearer legacy-at");
});

test("the new directory wins when both have a token", async () => {
  const sb = sandbox(mock);
  writeAt(sb.legacyTokenFile, "legacy-at");
  writeAt(sb.tokenFile, "new-at");
  assert.equal(await tokenUsedBy(sb), "Bearer new-at");
});
