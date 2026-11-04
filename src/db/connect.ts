import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

import { createDb } from "./index";

export const DEFAULT_DATABASE_URL = "file:./data/dev.db";

export function getDatabaseUrl(): string {
  return process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL;
}

/** Path of a local `file:` database URL, or null for any other kind of URL. */
export function localDatabasePath(url: string): string | null {
  if (!url.startsWith("file:")) return null;
  return url.slice("file:".length).split("?")[0];
}

/**
 * Opens the database configured in DATABASE_URL (see .env.example). For a
 * local file, creates its folder first, since SQLite does not.
 */
export function connectFromEnv() {
  const url = getDatabaseUrl();
  const path = localDatabasePath(url);
  if (path) mkdirSync(dirname(path), { recursive: true });
  return createDb(url, process.env.DATABASE_AUTH_TOKEN);
}
