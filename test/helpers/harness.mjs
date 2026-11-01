import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const root = path.resolve(import.meta.dirname, "../..");
const preload = path.join(import.meta.dirname, "redirect-fetch.mjs");
const APP = "youtube-playlists-mcp";

/**
 * A fake Google. `routes` maps a request path (e.g. "/token", "/playlists") to a function that
 * receives the request and returns { status, body } (JSON) or { status, raw, type } (verbatim).
 * Unrouted paths answer 404. Every request is recorded in `requests`.
 */
export async function startMock(routes) {
  const requests = [];
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (d) => {
      body += d;
    });
    req.on("end", () => {
      const pathname = req.url.split("?")[0];
      requests.push({
        path: pathname,
        query: new URLSearchParams(req.url.split("?")[1] ?? ""),
        auth: req.headers.authorization,
        body,
      });
      const handler = routes[pathname];
      const r = handler
        ? handler(requests.filter((q) => q.path === pathname).length)
        : { status: 404, body: {} };
      res.writeHead(r.status, { "content-type": r.type ?? "application/json" });
      res.end(r.raw ?? JSON.stringify(r.body));
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    port: server.address().port,
    requests,
    calls: (p) => requests.filter((r) => r.path === p),
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

/** An empty HOME with the app's config and cache directories, plus the env to run against a mock. */
export function sandbox(mock, extraEnv = {}) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "ygbc-"));
  const configDir = path.join(home, ".config", APP);
  const cacheDir = path.join(home, ".cache", APP);
  fs.mkdirSync(configDir, { recursive: true });
  fs.mkdirSync(cacheDir, { recursive: true });
  return {
    home,
    legacyTokenFile: path.join(home, ".config", "youtube-grok-bot-connector", "token.json"),
    tokenFile: path.join(configDir, "token.json"),
    pendingFile: path.join(configDir, "pending-auth.json"),
    cacheFile: path.join(cacheDir, "search-cache.json"),
    env: {
      PATH: process.env.PATH,
      HOME: home,
      YOUTUBE_CLIENT_ID: "test-client-id",
      YOUTUBE_CLIENT_SECRET: "test-client-secret",
      ...(mock ? { MOCK_GOOGLE_PORT: String(mock.port) } : {}),
      ...extraEnv,
    },
  };
}

export const futureExpiry = () => Date.now() + 50 * 60_000;

export function writeToken(sb, token) {
  fs.writeFileSync(sb.tokenFile, JSON.stringify(token), { mode: 0o600 });
}

/** Starts the MCP server over stdio and returns a client plus a `call` helper. */
export async function connectServer(sb) {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["--import", preload, path.join(root, "dist/index.js")],
    env: sb.env,
    stderr: "pipe",
  });
  const client = new Client({ name: "test", version: "0" });
  await client.connect(transport);
  return {
    client,
    async call(name, args = {}) {
      const r = await client.callTool({ name, arguments: args });
      return { isError: r.isError === true, text: r.content[0].text };
    },
    close: () => client.close(),
  };
}

/** Runs `index.js auth ...` once against the mock (async so the in-process mock can answer). */
export function runAuth(sb, args) {
  return runNode(["--import", preload, path.join(root, "dist/index.js"), "auth", ...args], sb.env);
}

function runNode(args, env, timeoutMs = 10_000) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, args, { env, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => {
      stdout += d;
    });
    child.stderr.on("data", (d) => {
      stderr += d;
    });
    const timer = setTimeout(() => child.kill(), timeoutMs);
    child.on("close", (status) => {
      clearTimeout(timer);
      resolve({ status, stdout, stderr });
    });
  });
}

/** Runs the server until it exits or, if it starts fine, until stdin closes. */
export function runServerBriefly(sb) {
  return runNode([path.join(root, "dist/index.js")], sb.env, 5000);
}
