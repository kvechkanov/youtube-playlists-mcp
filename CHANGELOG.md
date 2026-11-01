# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [0.2.0] - 2026-11-01

First public release as `youtube-playlists-mcp`.

### Added
- `youtube-playlists-mcp auth [url|finish <URL>]` runs the sign-in helper through the main command, so `npx` users need no second binary.
- Tests against a mock Google server, Biome lint and format, and GitHub Actions CI.

### Changed
- Renamed from `youtube-grok-bot-connector`. The default config and cache directories are now `~/.config/youtube-playlists-mcp` and `~/.cache/youtube-playlists-mcp`. A token left in `~/.config/youtube-grok-bot-connector` is still used when the new directory has none.
- `auth finish` now requires the full redirect URL, not a bare code, and checks its `state` value.
- Requires Node.js 22 or later.

### Fixed
- The published package now includes the compiled `dist` (`prepare` builds it).
- A corrupt token file reports "re-run auth" and names the file. A corrupt search cache is discarded.
- A non-JSON response from Google (for example an HTML error page) reports its HTTP status instead of a JSON parse error.
- Token and cache files are written atomically.
- A 401 from the API refreshes the access token and retries the call once.
- A redirect URL with a missing or wrong `state` is rejected.
- An expired or already-used authorization code gets its own message, separate from the refresh-token message.
- Invalid `YOUTUBE_REDIRECT_PORT` or `YOUTUBE_SEARCH_CACHE_TTL_HOURS` values stop startup with a clear error.
- Empty IDs and blank search queries are rejected before any request, so they cost no quota.
- Playlist URLs without `https://` are accepted, and a URL with no playlist gives a clear error.
