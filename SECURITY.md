# Security policy

## Supported versions

Only the latest release receives fixes.

## Reporting a vulnerability

Please report it privately through [GitHub's "Report a vulnerability"](https://github.com/kvechkanov/youtube-playlists-mcp/security/advisories/new) form, or email kvechkanov1@gmail.com. Do not open a public issue. You will get a reply within a few days.

## What to know

- The connector stores a Google OAuth refresh token in `~/.config/youtube-playlists-mcp/token.json` (mode `600`). The `youtube` scope can manage your whole YouTube account, so treat that file like a password. Revoke access any time at <https://myaccount.google.com/permissions>.
- Your OAuth client ID and secret are read from environment variables and never written to disk by this project.
- The server only contacts `accounts.google.com`, `oauth2.googleapis.com` and `www.googleapis.com`.
