# youtube-playlists-mcp

[![CI](https://github.com/kvechkanov/youtube-playlists-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/kvechkanov/youtube-playlists-mcp/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
![Node.js 22+](https://img.shields.io/badge/node-%3E%3D22-brightgreen.svg)

A small [Model Context Protocol](https://modelcontextprotocol.io) (MCP) server that wraps the **YouTube Data API v3**, so an AI assistant can manage *your* YouTube playlists (for example a "learning watch list") and search for videos.

- Transport: **stdio**
- Language: TypeScript (Node.js 22+)
- Auth: OAuth 2.0 with PKCE, scope `https://www.googleapis.com/auth/youtube`. Tokens refresh automatically, and a rejected token is refreshed and the call retried once.
- Quota-aware: every tool description states its quota cost, and search results are cached.

## Tools

| Tool | What it does | Quota cost |
|---|---|---|
| `list_my_playlists` | Lists your playlists (id, title, item count, privacy) | 1 |
| `list_playlist_items` | Lists videos in a playlist, with `playlistItemId` and `videoId` | 1 per page (50 items) |
| `add_to_playlist` | Adds a video (ID or URL) to a playlist | 50 |
| `remove_playlist_item` | Removes an entry by `playlistItemId` | 50 |
| `create_playlist` | Creates a playlist (private by default) | 50 |
| `search_videos` | Searches videos, up to 10 results | **100** (0 when served from cache) |

### Quota

The default quota is **10,000 units per day per Google Cloud project** and resets at midnight Pacific time. `search_videos` is the expensive one: about 100 uncached searches a day would use it all. Identical searches (same query, page size, page token) are cached on disk for 24 hours (`YOUTUBE_SEARCH_CACHE_TTL_HOURS`) and cost nothing. If you hit the limit, tools return a `quotaExceeded` error. See the [quota calculator](https://developers.google.com/youtube/v3/determine_quota_cost) for costs.

## Setup

### 1. Google Cloud (one time, about 10 minutes)

1. Open the [Google Cloud Console](https://console.cloud.google.com/) and create a project.
2. **APIs & Services → Library**: enable **YouTube Data API v3**.
3. **APIs & Services → OAuth consent screen** (Google Auth Platform): choose **External**, fill in the app name and your email, and add your Google account under **Test users** (Google Auth Platform → **Audience** → **Add users**). If you skip this, sign-in fails with *"Access blocked: … has not completed the Google verification process"*.
4. **Credentials → Create credentials → OAuth client ID**, application type **Desktop app**. Leave **"Use this client for an AI-powered agent"** unticked (it is for clients that use Google's own MCP tools; this server calls the YouTube Data API directly). Copy the client ID and client secret.
5. Optional but recommended: once everything works, set the consent screen's publishing status to **In production**. For personal use you don't need Google verification (you'll see an "unverified app" warning that you can click through). While the app is in **Testing**, Google expires refresh tokens after **7 days**, and you'd have to re-run the auth step weekly.

### 2. Install and build

```bash
git clone https://github.com/kvechkanov/youtube-playlists-mcp.git
cd youtube-playlists-mcp
npm install   # also builds dist/
```

Or skip the clone and run it straight from GitHub with `npx github:kvechkanov/youtube-playlists-mcp` (npm builds it on first use). Everywhere below, `node dist/index.js` and `npx github:kvechkanov/youtube-playlists-mcp` are interchangeable. The package is not published to the npm registry.

### 3. Authorize (one time)

Set your credentials in the environment (don't commit them):

```bash
export YOUTUBE_CLIENT_ID="...apps.googleusercontent.com"
export YOUTUBE_CLIENT_SECRET="..."
```

The script works on machines where you can't open a browser to `localhost` (a remote box, for example). It prints a sign-in URL; after you sign in, your browser is redirected to `http://localhost:8085/?code=...`, which fails to load. That's expected. Copy the **full URL** from the address bar and give it back to the script.

Interactive:

```bash
node dist/index.js auth
```

Or in two non-interactive steps (useful when someone else relays the URL):

```bash
node dist/index.js auth url        # prints the sign-in URL and saves PKCE state
node dist/index.js auth finish "http://localhost:8085/?code=...&state=..."
```

Paste the **whole URL**, not just the code: its `state` value is checked against the one saved by `url`.

The refresh token is written to `~/.config/youtube-playlists-mcp/token.json` with mode `600`. The PKCE state from `url` is valid for 30 minutes and must be used on the same machine and user.

### 4. Run the server

```bash
YOUTUBE_CLIENT_ID=... YOUTUBE_CLIENT_SECRET=... node dist/index.js
```

Register it in any MCP client (Claude Desktop, Cursor, Grok Bot, ...) as a stdio server:

```json
{
  "mcpServers": {
    "youtube": {
      "command": "node",
      "args": ["/absolute/path/to/youtube-playlists-mcp/dist/index.js"],
      "env": {
        "YOUTUBE_CLIENT_ID": "...apps.googleusercontent.com",
        "YOUTUBE_CLIENT_SECRET": "..."
      }
    }
  }
}
```

To run it from GitHub instead of a local clone, use `"command": "npx"` with `"args": ["-y", "github:kvechkanov/youtube-playlists-mcp"]` and the same `env`.

Without credentials or a token, the server still starts and lists its tools. Calling a tool returns an error beginning with `NOT AUTHORIZED:` that says what to do.

## Configuration

| Variable | Default | Purpose |
|---|---|---|
| `YOUTUBE_CLIENT_ID` | (required) | OAuth client ID |
| `YOUTUBE_CLIENT_SECRET` | (required) | OAuth client secret |
| `YOUTUBE_TOKEN_PATH` | `~/.config/youtube-playlists-mcp/token.json` | Where the token is stored |
| `YOUTUBE_CONFIG_DIR` | `~/.config/youtube-playlists-mcp` | Token and pending-auth directory. A token in the old `~/.config/youtube-grok-bot-connector` is used if the new directory has none |
| `YOUTUBE_CACHE_DIR` | `~/.cache/youtube-playlists-mcp` | Search cache directory |
| `YOUTUBE_SEARCH_CACHE_TTL_HOURS` | `24` | Search cache lifetime in hours (0 or more) |
| `YOUTUBE_REDIRECT_PORT` | `8085` | Port in the redirect URI (nothing listens on it; Desktop-app clients accept any loopback port) |

Invalid numeric values (`YOUTUBE_REDIRECT_PORT`, `YOUTUBE_SEARCH_CACHE_TTL_HOURS`) stop startup with an error naming the variable.

## Troubleshooting

| Symptom | Fix |
|---|---|
| *Access blocked: … has not completed the Google verification process* | Add your Google account under **Test users** (Audience page), or publish the app. |
| *Google hasn't verified this app* warning | Expected for personal apps. Click **Advanced → Go to … (unsafe)**. |
| `localhost:8085` page fails to load after sign-in | Expected. Copy the full URL from the address bar and paste it into `auth` / `auth finish`. |
| *authorization code … expired or was already used* | Run `auth url` again and sign in with the new link. |
| *refresh token rejected* every ~7 days | The app is in **Testing**. Set publishing status to **In production**, then re-run `auth`. |
| *Google did not return a refresh token* | Revoke the app at <https://myaccount.google.com/permissions> and run `auth` again. |
| *token file … is corrupt* | Delete that file and run `auth` again. |
| `quotaExceeded` | The 10,000 daily units are used up. It resets at midnight Pacific time. |

## Security notes

- Secrets live only in environment variables and the `600`-mode token file, outside the repository. `.gitignore` also excludes `token.json`, `.env`, and credentials files.
- The scope `youtube` grants full management of your YouTube account (playlists, and more). Treat the token like a password. Revoke it any time at <https://myaccount.google.com/permissions>.
- The server only calls Google endpoints (`accounts.google.com`, `oauth2.googleapis.com`, `www.googleapis.com`).

## Development

```bash
npm run build      # compile to dist/
npm run lint       # Biome; `npm run format` fixes
npm run typecheck
npm test           # builds, then runs the tests
```

The tests start the server and the auth CLI in an empty home directory against a local mock of Google's endpoints, so they make no network calls. See [CONTRIBUTING.md](CONTRIBUTING.md) and the [CHANGELOG](CHANGELOG.md).

## License

[MIT](LICENSE) © 2026 Kostya Vechkanov
