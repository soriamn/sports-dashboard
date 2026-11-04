import { rmSync } from "node:fs";

import {
  connectFromEnv,
  getDatabaseUrl,
  localDatabasePath,
} from "../src/db/connect";
import { runMigrations } from "../src/db/migrate";
import { seed } from "../src/db/seed";

// Deletes the local database file, then migrates and seeds a fresh one.
const url = getDatabaseUrl();
const path = localDatabasePath(url);
if (!path) {
  console.error(`Refusing to reset ${url}: only local file: databases.`);
  process.exit(1);
}

for (const suffix of ["", "-wal", "-shm", "-journal"]) {
  rmSync(path + suffix, { force: true });
}

const { client, db } = connectFromEnv();
await runMigrations(db);
const counts = await seed(db);
client.close();
console.log(
  `Reset ${url}: seeded ${counts.teams} teams and ${counts.events} events.`,
);
