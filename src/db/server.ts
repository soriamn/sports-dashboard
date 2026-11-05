import { connectFromEnv } from "./connect";

// One connection per server process. In development, hot reloading re-runs
// this module, so the connection is kept on globalThis to avoid opening a new
// one on every change.
const globalForDb = globalThis as unknown as {
  __sportsDashboardDb?: ReturnType<typeof connectFromEnv>;
};

/**
 * The database used by the website and API routes. Run `npm run db:reset` first
 * if the local database file does not exist yet.
 */
export function getDb() {
  globalForDb.__sportsDashboardDb ??= connectFromEnv();
  return globalForDb.__sportsDashboardDb.db;
}
