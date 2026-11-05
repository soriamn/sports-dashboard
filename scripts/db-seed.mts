import {
  connectFromEnv,
  getDatabaseUrl,
  localDatabasePath,
} from "../src/db/connect";
import { seed } from "../src/db/seed";

// The seed deletes existing rows, so it only runs against local files.
const url = getDatabaseUrl();
if (!localDatabasePath(url)) {
  console.error(`Refusing to seed ${url}: only local file: databases.`);
  process.exit(1);
}

const { client, db } = connectFromEnv();
const counts = await seed(db);
client.close();
console.log(`Seeded ${counts.teams} teams and ${counts.events} events.`);
