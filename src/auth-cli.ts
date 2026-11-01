#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import readline from "node:readline/promises";
import { AUTH_ENDPOINT, clientCredentials, paths, REDIRECT_URI, SCOPE } from "./config.js";
import { readJson, writeSecretJson } from "./fsutil.js";
import { InvalidGrantError, postToken, saveToken } from "./tokens.js";

interface Pending {
  verifier: string;
  state: string;
  createdAt: number;
}

const b64url = (b: Buffer) => b.toString("base64url");

function startAuth(): string {
  const { clientId } = clientCredentials();
  const verifier = b64url(crypto.randomBytes(64));
  const challenge = b64url(crypto.createHash("sha256").update(verifier).digest());
  const state = b64url(crypto.randomBytes(16));
  writeSecretJson(paths.pending, { verifier, state, createdAt: Date.now() } satisfies Pending);
  const u = new URL(AUTH_ENDPOINT);
  u.search = new URLSearchParams({
    client_id: clientId,
    redirect_uri: REDIRECT_URI,
    response_type: "code",
    scope: SCOPE,
    code_challenge: challenge,
    code_challenge_method: "S256",
    state,
    access_type: "offline",
    prompt: "consent",
  }).toString();
  return u.toString();
}

async function finishAuth(input: string): Promise<void> {
  let pending: Pending | undefined;
  try {
    pending = readJson<Pending>(paths.pending);
  } catch {
    // A corrupt pending file is as good as none: the user must run "url" again.
  }
  if (!pending) throw new Error(`No pending auth at ${paths.pending}. Run "url" first.`);
  if (Date.now() - pending.createdAt > 30 * 60_000) {
    throw new Error('Pending auth is older than 30 minutes. Run "url" again.');
  }
  input = input.trim();
  if (!/^https?:\/\//i.test(input)) {
    throw new Error(
      "Paste the full redirect URL from the address bar (it contains ?code=...&state=...), not just the code.",
    );
  }
  const u = new URL(input);
  const err = u.searchParams.get("error");
  if (err) throw new Error(`Google returned an error: ${err}`);
  const code = u.searchParams.get("code");
  if (!code) throw new Error("No ?code= parameter found in the URL you pasted.");
  if (u.searchParams.get("state") !== pending.state) {
    throw new Error(
      'The URL has a missing or mismatched "state" value, so it does not belong to this sign-in attempt. Run "url" again and use the new link.',
    );
  }
  const { clientId, clientSecret } = clientCredentials();
  let r: Awaited<ReturnType<typeof postToken>>;
  try {
    r = await postToken({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      code_verifier: pending.verifier,
      grant_type: "authorization_code",
      redirect_uri: REDIRECT_URI,
    });
  } catch (e) {
    if (!(e instanceof InvalidGrantError)) throw e;
    throw new Error(
      `Google rejected the authorization code (${e.message}): it has expired or was already used. Run "url" again and sign in with the new link.`,
    );
  }
  if (!r.refresh_token) {
    throw new Error(
      "Google did not return a refresh token. Revoke the app at https://myaccount.google.com/permissions and retry.",
    );
  }
  saveToken({
    refresh_token: r.refresh_token,
    access_token: r.access_token,
    expires_at: Date.now() + r.expires_in * 1000,
    scope: r.scope,
  });
  fs.rmSync(paths.pending, { force: true });
  console.log(`Authorized. Token saved to ${paths.token} (mode 600).`);
}

const USAGE = `Usage:
  youtube-playlists-mcp auth               interactive: prints the sign-in URL, then prompts for the pasted URL
  youtube-playlists-mcp auth url           step 1: print the sign-in URL (saves PKCE state)
  youtube-playlists-mcp auth finish <URL>  step 2: exchange the pasted redirect URL for a token
Requires YOUTUBE_CLIENT_ID and YOUTUBE_CLIENT_SECRET in the environment.`;

const INSTRUCTIONS = `Open the URL above and sign in. The browser will then land on a page at ${REDIRECT_URI}/?code=... that fails to load. That is expected: copy the FULL address from the address bar.`;

async function main() {
  const [cmd, arg] = process.argv.slice(2);
  if (cmd === "-h" || cmd === "--help") return console.log(USAGE);
  if (cmd === "url") {
    console.log(startAuth());
    console.error(`\n${INSTRUCTIONS}\nThen run: finish "<pasted URL>"`);
  } else if (cmd === "finish") {
    if (!arg) throw new Error(USAGE);
    await finishAuth(arg);
  } else if (!cmd) {
    console.log(startAuth());
    console.log(`\n${INSTRUCTIONS}\n`);
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const pasted = await rl.question("Paste the full URL here: ");
    rl.close();
    await finishAuth(pasted);
  } else {
    throw new Error(USAGE);
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
