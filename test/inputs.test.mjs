import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { extractPlaylistId } from "../dist/youtube.js";
import { connectServer, futureExpiry, sandbox, startMock, writeToken } from "./helpers/harness.mjs";

let mock;
let server;
before(async () => {
  mock = await startMock({
    "/playlists": () => ({ status: 200, body: { items: [] } }),
    "/playlistItems": () => ({ status: 200, body: { items: [] } }),
    "/search": () => ({ status: 200, body: { items: [] } }),
  });
  const sb = sandbox(mock);
  writeToken(sb, { refresh_token: "rt", access_token: "at", expires_at: futureExpiry() });
  server = await connectServer(sb);
});
after(async () => {
  await server.close();
  await mock.close();
});

async function rejectedWithoutRequest(name, args) {
  const before = mock.requests.length;
  const r = await server.call(name, args);
  assert.equal(r.isError, true, `${name} ${JSON.stringify(args)} should be rejected`);
  assert.equal(mock.requests.length, before, "no request should reach Google");
}

test("empty or blank IDs and queries are rejected before any request to Google", async () => {
  await rejectedWithoutRequest("list_playlist_items", { playlistId: "" });
  await rejectedWithoutRequest("add_to_playlist", { playlistId: "", video: "dQw4w9WgXcQ" });
  await rejectedWithoutRequest("add_to_playlist", { playlistId: "PLabc", video: "  " });
  await rejectedWithoutRequest("remove_playlist_item", { playlistItemId: "" });
  await rejectedWithoutRequest("remove_playlist_item", { playlistItemId: "   " });
  await rejectedWithoutRequest("search_videos", { query: "   " });
});

test("a padded search query is sent trimmed", async () => {
  const r = await server.call("search_videos", { query: "  padded query  " });
  assert.equal(r.isError, false, r.text);
  assert.equal(mock.calls("/search").at(-1).query.get("q"), "padded query");
});

test("a playlist URL without a scheme is accepted", async () => {
  const r = await server.call("list_playlist_items", {
    playlistId: "youtube.com/playlist?list=PLabc123",
  });
  assert.equal(r.isError, false, r.text);
  assert.equal(mock.calls("/playlistItems").at(-1).query.get("playlistId"), "PLabc123");
});

test("a URL with no playlist is rejected with a clear error and no request", async () => {
  for (const playlistId of [
    "https://",
    "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    "not a playlist!",
  ]) {
    const before = mock.requests.length;
    const r = await server.call("list_playlist_items", { playlistId });
    assert.equal(r.isError, true, playlistId);
    assert.match(r.text, /playlist ID/i);
    assert.equal(mock.requests.length, before);
  }
});

test("extractPlaylistId accepts bare IDs and URLs with or without a scheme", () => {
  assert.equal(extractPlaylistId("PLabc_123-x"), "PLabc_123-x");
  assert.equal(extractPlaylistId(" https://www.youtube.com/playlist?list=PLabc "), "PLabc");
  assert.equal(extractPlaylistId("www.youtube.com/watch?v=dQw4w9WgXcQ&list=PLz"), "PLz");
});
