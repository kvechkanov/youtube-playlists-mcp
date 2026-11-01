import fs from "node:fs";
import path from "node:path";

export class CorruptFileError extends Error {
  constructor(readonly file: string) {
    super(`${file} is not valid JSON`);
    this.name = "CorruptFileError";
  }
}

/** Write via a temp file and rename so a crash never leaves a half-written file. */
export function writeFileAtomic(file: string, data: string, mode: number): void {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(tmp, data, { mode });
    fs.chmodSync(tmp, mode);
    fs.renameSync(tmp, file);
  } catch (e) {
    fs.rmSync(tmp, { force: true });
    throw e;
  }
}

/** Write JSON atomically with owner-only permissions (0600; directory 0700). */
export function writeSecretJson(file: string, data: unknown): void {
  writeFileAtomic(file, JSON.stringify(data, null, 2), 0o600);
}

/** Returns undefined when the file is missing; throws CorruptFileError when it is not JSON. */
export function readJson<T>(file: string): T | undefined {
  let text: string;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw e;
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new CorruptFileError(file);
  }
}
