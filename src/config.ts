import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const APP = "youtube-playlists-mcp";
const LEGACY_APP = "youtube-grok-bot-connector";

function expandHome(p: string): string {
  return p.startsWith("~") ? path.join(os.homedir(), p.slice(1)) : p;
}

export const SCOPE = "https://www.googleapis.com/auth/youtube";
export const AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
export const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
export const API_BASE = "https://www.googleapis.com/youtube/v3";

/** Read a numeric setting, or stop with a message naming the variable when it is not valid. */
function numberEnv(
  name: string,
  fallback: number,
  ok: (n: number) => boolean,
  rule: string,
): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || !ok(n)) {
    console.error(`Invalid ${name}="${raw}": expected ${rule}.`);
    process.exit(1);
  }
  return n;
}

/** Port only appears in the redirect URI; nothing listens on it. */
export const REDIRECT_PORT = numberEnv(
  "YOUTUBE_REDIRECT_PORT",
  8085,
  (n) => Number.isInteger(n) && n >= 1 && n <= 65535,
  "an integer from 1 to 65535",
);
export const REDIRECT_URI = `http://localhost:${REDIRECT_PORT}`;

const legacyConfigDir = path.join(os.homedir(), ".config", LEGACY_APP);
const defaultConfigDir = path.join(os.homedir(), ".config", APP);

/** Installs made before the rename keep their token in the old directory; keep using it. */
const configDir = expandHome(
  process.env.YOUTUBE_CONFIG_DIR ??
    (!fs.existsSync(path.join(defaultConfigDir, "token.json")) &&
    fs.existsSync(path.join(legacyConfigDir, "token.json"))
      ? legacyConfigDir
      : defaultConfigDir),
);

export const paths = {
  configDir,
  token: expandHome(process.env.YOUTUBE_TOKEN_PATH ?? path.join(configDir, "token.json")),
  pending: path.join(configDir, "pending-auth.json"),
  cacheDir: expandHome(process.env.YOUTUBE_CACHE_DIR ?? path.join(os.homedir(), ".cache", APP)),
};

export const SEARCH_CACHE_TTL_MS =
  numberEnv("YOUTUBE_SEARCH_CACHE_TTL_HOURS", 24, (n) => n >= 0, "a number of hours, 0 or more") *
  3600 *
  1000;

export function clientCredentials(): { clientId: string; clientSecret: string } {
  const clientId = process.env.YOUTUBE_CLIENT_ID;
  const clientSecret = process.env.YOUTUBE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new NotAuthorizedError(
      "YOUTUBE_CLIENT_ID and YOUTUBE_CLIENT_SECRET are not set. Create an OAuth client (Desktop app) in Google Cloud and pass both as environment variables.",
    );
  }
  return { clientId, clientSecret };
}

export class NotAuthorizedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NotAuthorizedError";
  }
}
