import { API_BASE } from "./config.js";
import { readJsonBody } from "./http.js";
import { getAccessToken } from "./tokens.js";

export class YouTubeApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly reason?: string,
  ) {
    super(message);
    this.name = "YouTubeApiError";
  }
}

type Query = Record<string, string | number | boolean | undefined>;

export async function ytFetch<T>(
  method: "GET" | "POST" | "DELETE",
  endpoint: string,
  query: Query = {},
  body?: unknown,
): Promise<T> {
  const url = new URL(`${API_BASE}/${endpoint}`);
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined && v !== "") url.searchParams.set(k, String(v));
  }
  const send = (token: string) =>
    fetch(url, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        ...(body !== undefined ? { "content-type": "application/json" } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  const token = await getAccessToken();
  let res = await send(token);
  if (res.status === 401) res = await send(await getAccessToken(token));
  if (res.status === 204) return undefined as T;
  const json = await readJsonBody(res, "YouTube API");
  if (!res.ok) {
    const err = json?.error;
    const reason = err?.errors?.[0]?.reason as string | undefined;
    let msg = `YouTube API ${res.status}${reason ? ` (${reason})` : ""}: ${err?.message ?? res.statusText}`;
    if (reason === "quotaExceeded") {
      msg +=
        " The daily quota (10,000 units by default) is used up; it resets at midnight Pacific time.";
    }
    throw new YouTubeApiError(msg, res.status, reason);
  }
  return json as T;
}

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

/** Accepts a bare 11-char ID or a watch / youtu.be / shorts / embed / live URL. */
export function parseVideoId(input: string): string {
  const s = input.trim();
  if (VIDEO_ID.test(s)) return s;
  let u: URL;
  try {
    u = new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`);
  } catch {
    throw new Error(`Cannot extract a video ID from "${input}".`);
  }
  const host = u.hostname.replace(/^(www|m|music)\./, "");
  let id: string | null | undefined;
  if (host === "youtu.be") id = u.pathname.split("/")[1];
  else if (host === "youtube.com" || host === "youtube-nocookie.com") {
    id = u.searchParams.get("v");
    if (!id) {
      const m = u.pathname.match(/^\/(?:shorts|embed|live|v)\/([^/?#]+)/);
      id = m?.[1];
    }
  }
  if (!id || !VIDEO_ID.test(id)) throw new Error(`Cannot extract a video ID from "${input}".`);
  return id;
}

const PLAYLIST_ID = /^[A-Za-z0-9_-]+$/;

/** Accepts a bare playlist ID or any URL (scheme optional) carrying ?list=... */
export function extractPlaylistId(input: string): string {
  const s = input.trim();
  if (PLAYLIST_ID.test(s)) return s;
  const fail = () =>
    new Error(
      `Cannot extract a playlist ID from "${input}". Pass a playlist ID or a URL containing ?list=...`,
    );
  let list: string | null;
  try {
    list = new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`).searchParams.get("list");
  } catch {
    throw fail();
  }
  if (!list || !PLAYLIST_ID.test(list)) throw fail();
  return list;
}
