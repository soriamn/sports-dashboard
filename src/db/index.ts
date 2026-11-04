import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";

import * as schema from "./schema";

export type Db = ReturnType<typeof createDb>["db"];

/**
 * Opens a database. `url` is a local `file:` URL in development (or
 * `:memory:` in tests) and a remote `libsql://` URL in production.
 *
 * The libSQL client enforces foreign keys by default; `db.test.ts` guards
 * that, because SQLite itself does not.
 */
export function createDb(url: string, authToken?: string) {
  const client = createClient({ url, authToken });
  const db = drizzle(client, { schema });
  return { client, db };
}

export { schema };
