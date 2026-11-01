import path from "node:path";
import { paths, SEARCH_CACHE_TTL_MS } from "./config.js";
import { readJson, writeFileAtomic } from "./fsutil.js";

interface Entry {
  at: number;
  value: unknown;
}
type Store = Record<string, Entry>;

const file = path.join(paths.cacheDir, "search-cache.json");
let mem: Store | undefined;

function load(): Store {
  if (mem) return mem;
  let stored: unknown;
  try {
    stored = readJson<Store>(file);
  } catch {
    // The cache is disposable: an unreadable or corrupt file is discarded.
  }
  mem = stored && typeof stored === "object" && !Array.isArray(stored) ? (stored as Store) : {};
  return mem;
}

export function cacheGet<T>(key: string): T | undefined {
  const e = load()[key];
  if (!e) return undefined;
  if (Date.now() - e.at > SEARCH_CACHE_TTL_MS) {
    delete load()[key];
    return undefined;
  }
  return e.value as T;
}

export function cacheSet(key: string, value: unknown): void {
  const store = load();
  store[key] = { at: Date.now(), value };
  const keys = Object.keys(store);
  if (keys.length > 500) {
    const oldest = keys.sort((a, b) => store[a].at - store[b].at).slice(0, keys.length - 500);
    for (const k of oldest) delete store[k];
  }
  try {
    writeFileAtomic(file, JSON.stringify(store), 0o600);
  } catch {
    // Disk cache is best-effort; the in-memory copy still works.
  }
}
