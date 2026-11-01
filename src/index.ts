#!/usr/bin/env node
// `youtube-playlists-mcp auth ...` runs the sign-in helper; anything else starts the MCP server.
if (process.argv[2] === "auth") {
  process.argv.splice(2, 1);
  await import("./auth-cli.js");
} else {
  await import("./server.js");
}
