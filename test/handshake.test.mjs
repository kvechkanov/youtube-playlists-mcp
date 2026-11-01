import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { parseVideoId } from "../dist/youtube.js";

test("parseVideoId handles ids and URL shapes", () => {
  const id = "dQw4w9WgXcQ";
  for (const s of [
    id,
    `https://www.youtube.com/watch?v=${id}&list=PLx`,
    `https://youtu.be/${id}?t=5`,
    `https://www.youtube.com/shorts/${id}`,
    `https://m.youtube.com/embed/${id}`,
    `youtube.com/watch?v=${id}`,
  ])
    assert.equal(parseVideoId(s), id);
  assert.throws(() => parseVideoId("https://example.com/x"));
});

test("server lists tools and reports 'not authorized' without credentials", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "yt-mcp-"));
  const env = { PATH: process.env.PATH, HOME: home };
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [path.resolve("dist/index.js")],
    env,
  });
  const client = new Client({ name: "test", version: "0" });
  await client.connect(transport);
  const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
  assert.deepEqual(client.getServerVersion(), { name: pkg.name, version: pkg.version });
  const { tools } = await client.listTools();
  assert.deepEqual(tools.map((t) => t.name).sort(), [
    "add_to_playlist",
    "create_playlist",
    "list_my_playlists",
    "list_playlist_items",
    "remove_playlist_item",
    "search_videos",
  ]);
  for (const t of tools) assert.match(t.description, /[Qq]uota cost/);
  const r = await client.callTool({ name: "list_my_playlists", arguments: {} });
  assert.equal(r.isError, true);
  assert.match(r.content[0].text, /NOT AUTHORIZED/);
  await client.close();
});
