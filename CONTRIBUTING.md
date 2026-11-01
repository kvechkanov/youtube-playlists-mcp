# Contributing

Issues and pull requests are welcome.

```bash
git clone https://github.com/kvechkanov/youtube-playlists-mcp.git
cd youtube-playlists-mcp
npm ci
npm run lint        # Biome (use `npm run format` to fix)
npm run typecheck
npm test            # builds, then runs the tests against a mock Google server
```

- The tests never call Google. `test/helpers/` starts a local mock and redirects the server's `fetch` to it.
- Add a test for any behavior change. Test what a user of the tool can observe, not internals.
- Keep changes small and use [Conventional Commits](https://www.conventionalcommits.org) (`fix:`, `feat:`, `docs:`).
- Never commit tokens, client secrets, or `.env` files.
