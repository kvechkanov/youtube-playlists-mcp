import assert from "node:assert/strict";
import fs from "node:fs";
import { after, before, test } from "node:test";
import { runAuth, runServerBriefly, sandbox, startMock } from "./helpers/harness.mjs";

let mock;
let tokenReply;
before(async () => {
  mock = await startMock({ "/token": () => tokenReply });
});
after(() => mock.close());

const granted = {
  status: 200,
  body: { access_token: "at", expires_in: 3600, refresh_token: "rt-new" },
};
const invalidGrant = {
  status: 400,
  body: { error: "invalid_grant", error_description: "Bad Request" },
};

async function startAuth(sb) {
  const r = await runAuth(sb, ["url"]);
  assert.equal(r.status, 0, r.stderr);
  const state = new URL(r.stdout.trim()).searchParams.get("state");
  assert.ok(state);
  return state;
}

async function finishWith(query) {
  const sb = sandbox(mock);
  const state = await startAuth(sb);
  const redirect = `http://localhost:8085/?${query.replace("STATE", state)}`;
  const tokenCallsBefore = mock.calls("/token").length;
  const r = await runAuth(sb, ["finish", redirect]);
  return { sb, r, exchanged: mock.calls("/token").length - tokenCallsBefore };
}

test("finish stores the refresh token when the redirect carries the right state", async () => {
  tokenReply = granted;
  const { sb, r } = await finishWith("code=GOOD&state=STATE");
  assert.equal(r.status, 0, r.stderr);
  assert.equal(JSON.parse(fs.readFileSync(sb.tokenFile, "utf8")).refresh_token, "rt-new");
});

test("finish rejects a redirect with no state and never exchanges the code", async () => {
  tokenReply = granted;
  const { sb, r, exchanged } = await finishWith("code=FOREIGN");
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /state/i);
  assert.equal(exchanged, 0);
  assert.equal(fs.existsSync(sb.tokenFile), false);
});

test("finish rejects a redirect with the wrong state", async () => {
  tokenReply = granted;
  const { sb, r, exchanged } = await finishWith("code=FOREIGN&state=other");
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /state/i);
  assert.equal(exchanged, 0);
  assert.equal(fs.existsSync(sb.tokenFile), false);
});

test("finish rejects a bare code because it carries no state", async () => {
  tokenReply = granted;
  const sb = sandbox(mock);
  await startAuth(sb);
  const r = await runAuth(sb, ["finish", "4/0AbareCode"]);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /full (redirect )?URL/i);
});

test("an expired or reused authorization code says to run url again", async () => {
  tokenReply = invalidGrant;
  const { r } = await finishWith("code=USED&state=STATE");
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /authorization code.*expired.*already used/i);
  assert.match(r.stderr, /url/);
  assert.doesNotMatch(r.stderr, /refresh token/i);
});

for (const [name, value] of [
  ["YOUTUBE_REDIRECT_PORT", "abc"],
  ["YOUTUBE_REDIRECT_PORT", "70000"],
  ["YOUTUBE_SEARCH_CACHE_TTL_HOURS", "24h"],
  ["YOUTUBE_SEARCH_CACHE_TTL_HOURS", "-1"],
]) {
  test(`${name}=${value} stops startup with a message naming the variable`, async () => {
    const sb = sandbox(mock, { [name]: value });
    const server = await runServerBriefly(sb);
    assert.notEqual(server.status, 0);
    assert.ok(server.stderr.includes(name), server.stderr);
    const auth = await runAuth(sb, ["url"]);
    assert.notEqual(auth.status, 0);
    assert.ok(auth.stderr.includes(name), auth.stderr);
  });
}

test("valid numeric settings are accepted", async () => {
  const sb = sandbox(mock, {
    YOUTUBE_REDIRECT_PORT: "9000",
    YOUTUBE_SEARCH_CACHE_TTL_HOURS: "0.5",
  });
  const r = await runAuth(sb, ["url"]);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(new URL(r.stdout.trim()).searchParams.get("redirect_uri"), "http://localhost:9000");
});
