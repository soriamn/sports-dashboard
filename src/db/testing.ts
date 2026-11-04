import { createDb } from "./index";
import { runMigrations } from "./migrate";

/** A fresh, migrated, in-memory database for tests. Close it when done. */
export async function createTestDb() {
  const { client, db } = createDb(":memory:");
  await runMigrations(db);
  return { client, db };
}
