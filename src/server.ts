import { createRequire } from "node:module";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { cacheGet, cacheSet } from "./cache.js";
import { NotAuthorizedError } from "./config.js";
import { extractPlaylistId, parseVideoId, ytFetch } from "./youtube.js";

const { version } = createRequire(import.meta.url)("../package.json") as { version: string };
const server = new McpServer({ name: "youtube-playlists-mcp", version });

type Result = { content: { type: "text"; text: string }[]; isError?: boolean };

async function run(fn: () => Promise<unknown>): Promise<Result> {
  try {
    const data = await fn();
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const prefix = e instanceof NotAuthorizedError ? "NOT AUTHORIZED: " : "";
    return { content: [{ type: "text", text: prefix + msg }], isError: true };
  }
}

const nonEmpty = (description: string) => z.string().trim().min(1).describe(description);
const thumb = (s: any) => s?.thumbnails?.medium?.url ?? s?.thumbnails?.default?.url;

server.registerTool(
  "list_my_playlists",
  {
    description:
      "List the authenticated user's YouTube playlists (id, title, item count, privacy). Quota cost: 1 unit per call. Returns nextPageToken when more pages exist.",
    inputSchema: {
      maxResults: z.number().int().min(1).max(50).default(50).describe("Page size, 1-50."),
      pageToken: z.string().optional().describe("nextPageToken from a previous call."),
    },
  },
  ({ maxResults, pageToken }) =>
    run(async () => {
      const r: any = await ytFetch("GET", "playlists", {
        part: "snippet,contentDetails,status",
        mine: true,
        maxResults,
        pageToken,
      });
      return {
        playlists: (r.items ?? []).map((p: any) => ({
          playlistId: p.id,
          title: p.snippet?.title,
          description: p.snippet?.description,
          itemCount: p.contentDetails?.itemCount,
          privacy: p.status?.privacyStatus,
        })),
        nextPageToken: r.nextPageToken,
        totalResults: r.pageInfo?.totalResults,
      };
    }),
);

server.registerTool(
  "list_playlist_items",
  {
    description:
      "List the videos in a playlist. Each item includes playlistItemId (needed for remove_playlist_item) and videoId. Quota cost: 1 unit per call (50 items per page). Returns nextPageToken when more pages exist.",
    inputSchema: {
      playlistId: nonEmpty("Playlist ID (or a URL containing ?list=...)."),
      pageToken: z.string().optional().describe("nextPageToken from a previous call."),
    },
  },
  ({ playlistId, pageToken }) =>
    run(async () => {
      const r: any = await ytFetch("GET", "playlistItems", {
        part: "snippet,contentDetails,status",
        playlistId: extractPlaylistId(playlistId),
        maxResults: 50,
        pageToken,
      });
      return {
        items: (r.items ?? []).map((i: any) => ({
          playlistItemId: i.id,
          videoId: i.contentDetails?.videoId ?? i.snippet?.resourceId?.videoId,
          title: i.snippet?.title,
          channel: i.snippet?.videoOwnerChannelTitle,
          position: i.snippet?.position,
          addedAt: i.snippet?.publishedAt,
          privacy: i.status?.privacyStatus,
          url: `https://www.youtube.com/watch?v=${i.contentDetails?.videoId ?? i.snippet?.resourceId?.videoId}`,
        })),
        nextPageToken: r.nextPageToken,
        totalResults: r.pageInfo?.totalResults,
      };
    }),
);

server.registerTool(
  "add_to_playlist",
  {
    description:
      "Add a video to a playlist (appended at the end). Quota cost: 50 units per call. Does not check for duplicates.",
    inputSchema: {
      playlistId: nonEmpty("Target playlist ID."),
      video: nonEmpty("Video ID or URL (watch, youtu.be, shorts, embed)."),
    },
  },
  ({ playlistId, video }) =>
    run(async () => {
      const videoId = parseVideoId(video);
      const r: any = await ytFetch(
        "POST",
        "playlistItems",
        { part: "snippet" },
        {
          snippet: {
            playlistId: extractPlaylistId(playlistId),
            resourceId: { kind: "youtube#video", videoId },
          },
        },
      );
      return {
        playlistItemId: r.id,
        videoId,
        title: r.snippet?.title,
        playlistId: r.snippet?.playlistId,
        position: r.snippet?.position,
      };
    }),
);

server.registerTool(
  "remove_playlist_item",
  {
    description:
      "Remove an entry from a playlist by playlistItemId (from list_playlist_items; this is NOT the video ID). Quota cost: 50 units per call.",
    inputSchema: {
      playlistItemId: nonEmpty("playlistItemId from list_playlist_items."),
    },
  },
  ({ playlistItemId }) =>
    run(async () => {
      await ytFetch("DELETE", "playlistItems", { id: playlistItemId });
      return { removed: playlistItemId };
    }),
);

server.registerTool(
  "create_playlist",
  {
    description: "Create a new playlist. Quota cost: 50 units per call.",
    inputSchema: {
      title: z.string().trim().min(1).max(150),
      description: z.string().max(5000).default(""),
      privacy: z.enum(["private", "unlisted", "public"]).default("private"),
    },
  },
  ({ title, description, privacy }) =>
    run(async () => {
      const r: any = await ytFetch(
        "POST",
        "playlists",
        { part: "snippet,status" },
        { snippet: { title, description }, status: { privacyStatus: privacy } },
      );
      return {
        playlistId: r.id,
        title: r.snippet?.title,
        privacy: r.status?.privacyStatus,
        url: `https://www.youtube.com/playlist?list=${r.id}`,
      };
    }),
);

server.registerTool(
  "search_videos",
  {
    description:
      "Search YouTube for videos. EXPENSIVE: quota cost 100 units per uncached call (about 100 searches/day on the default 10,000-unit quota). Identical queries are served from a local cache (24h by default) at 0 units; the response says cached: true. Use sparingly.",
    inputSchema: {
      query: nonEmpty("Search text."),
      maxResults: z.number().int().min(1).max(10).default(5).describe("1-10 results."),
      pageToken: z
        .string()
        .optional()
        .describe("nextPageToken from a previous search (a new page costs 100 units)."),
    },
  },
  ({ query, maxResults, pageToken }) =>
    run(async () => {
      const key = JSON.stringify([query.trim().toLowerCase(), maxResults, pageToken ?? ""]);
      const hit = cacheGet<object>(key);
      if (hit) return { ...hit, cached: true, quotaCost: 0 };
      const r: any = await ytFetch("GET", "search", {
        part: "snippet",
        type: "video",
        q: query,
        maxResults,
        pageToken,
      });
      const value = {
        results: (r.items ?? []).map((i: any) => ({
          videoId: i.id?.videoId,
          title: i.snippet?.title,
          channel: i.snippet?.channelTitle,
          publishedAt: i.snippet?.publishedAt,
          description: i.snippet?.description,
          thumbnail: thumb(i.snippet),
          url: `https://www.youtube.com/watch?v=${i.id?.videoId}`,
        })),
        nextPageToken: r.nextPageToken,
      };
      cacheSet(key, value);
      return { ...value, cached: false, quotaCost: 100 };
    }),
);

await server.connect(new StdioServerTransport());
console.error("youtube-playlists-mcp MCP server running on stdio");
