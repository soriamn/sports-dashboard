import { connectFromEnv, getDatabaseUrl } from "../src/db/connect";
import { runMigrations } from "../src/db/migrate";

const { client, db } = connectFromEnv();
await runMigrations(db);
client.close();
console.log(`Migrations applied to ${getDatabaseUrl()}`);
