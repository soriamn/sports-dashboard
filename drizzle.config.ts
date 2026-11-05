import { defineConfig } from "drizzle-kit";

// DATABASE_URL comes from .env.local, loaded by the npm scripts
// (node --env-file). See .env.example.
export default defineConfig({
  dialect: "turso",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "file:./data/dev.db",
    authToken: process.env.DATABASE_AUTH_TOKEN,
  },
});
