import { createEspnAdapter } from "../src/adapters/espn/adapter";
import { connectFromEnv } from "../src/db/connect";
import { syncAdapter } from "../src/sync/sync";

// Copies football data from ESPN into the database in DATABASE_URL. Safe to run
// repeatedly: it updates what it already stored and never deletes anything.
// Unlike the seed, it is allowed against remote databases.

const { client, db } = connectFromEnv();

try {
  const result = await syncAdapter(db, createEspnAdapter(), {
    log: console.log,
  });

  const { competitions, participants, events } = result;
  console.log(
    `Done: ${competitions.created + competitions.updated} competitions, ` +
      `${participants.created + participants.updated} teams (${participants.created} new), ` +
      `${events.created + events.updated} events (${events.created} new), ` +
      `${result.standings} standing rows.`,
  );

  for (const { competition, error } of result.errors) {
    console.error(
      `\nFailed: ${competition}\n  ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (result.errors.length > 0) process.exitCode = 1;
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Sync failed: ${message}`);
  if (/no such table/i.test(message)) {
    console.error("The database has no tables yet. Run `npm run db:migrate`.");
  }
  process.exitCode = 1;
} finally {
  client.close();
}
