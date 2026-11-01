import { clientCredentials, NotAuthorizedError, paths, TOKEN_ENDPOINT } from "./config.js";
import { CorruptFileError, readJson, writeSecretJson } from "./fsutil.js";
import { readJsonBody } from "./http.js";

export interface StoredToken {
  refresh_token: string;
  access_token?: string;
  /** Epoch ms. */
  expires_at?: number;
  scope?: string;
}

interface TokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  scope?: string;
  error?: string;
  error_description?: string;
}

export function loadToken(): StoredToken | undefined {
  try {
    return readJson<StoredToken>(paths.token);
  } catch (e) {
    if (!(e instanceof CorruptFileError)) throw e;
    throw new NotAuthorizedError(
      `The token file ${paths.token} is corrupt. Delete it and re-run 'youtube-playlists-mcp auth' to sign in again.`,
    );
  }
}

export function saveToken(t: StoredToken): void {
  writeSecretJson(paths.token, t);
}

/** Google answered invalid_grant: the code or refresh token is expired, used or revoked. */
export class InvalidGrantError extends Error {
  constructor(detail: string) {
    super(detail);
    this.name = "InvalidGrantError";
  }
}

export async function postToken(params: Record<string, string>): Promise<TokenResponse> {
  const res = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params),
  });
  const body = ((await readJsonBody(res, "Google token endpoint")) ?? {}) as TokenResponse;
  if (!res.ok) {
    const detail = body.error_description ?? body.error ?? res.statusText;
    if (body.error === "invalid_grant") throw new InvalidGrantError(detail);
    throw new Error(`Token endpoint error ${res.status}: ${detail}`);
  }
  return body;
}

let inflight: Promise<string> | undefined;

/**
 * Returns a valid access token, refreshing and persisting it when needed.
 * Pass the token Google just rejected to force a refresh past the stored expiry.
 */
export function getAccessToken(rejected?: string): Promise<string> {
  inflight ??= refresh(rejected).finally(() => {
    inflight = undefined;
  });
  return inflight;
}

async function refresh(rejected?: string): Promise<string> {
  const stored = loadToken();
  if (!stored?.refresh_token) {
    throw new NotAuthorizedError(
      `Not authorized: no token at ${paths.token}. Run the one-time sign-in ('youtube-playlists-mcp auth', or 'auth url' then 'auth finish "<redirected URL>"'). See the README.`,
    );
  }
  if (
    stored.access_token &&
    stored.access_token !== rejected &&
    stored.expires_at &&
    stored.expires_at - Date.now() > 60_000
  ) {
    return stored.access_token;
  }
  const { clientId, clientSecret } = clientCredentials();
  let r: TokenResponse;
  try {
    r = await postToken({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: stored.refresh_token,
      grant_type: "refresh_token",
    });
  } catch (e) {
    if (!(e instanceof InvalidGrantError)) throw e;
    throw new NotAuthorizedError(
      `Google rejected the stored refresh token (${e.message}). It may have expired (7-day limit while the OAuth app is in Testing mode) or been revoked. Run 'youtube-playlists-mcp auth' again.`,
    );
  }
  saveToken({
    ...stored,
    refresh_token: r.refresh_token ?? stored.refresh_token,
    access_token: r.access_token,
    expires_at: Date.now() + r.expires_in * 1000,
    scope: r.scope ?? stored.scope,
  });
  return r.access_token;
}
