import "dotenv/config";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import { createClient } from "@libsql/client";
import { resolveDbCredentials } from "./env";

// Applies the generated SQL migrations in ./drizzle to the target database.
// Run against local.db in dev, or a Turso URL in prod (one-off, out of band —
// never in the request path or the Vercel build).
async function main() {
  const { url, authToken } = resolveDbCredentials();

  const client = createClient({ url, authToken });
  const db = drizzle(client);

  console.log(`Applying migrations to ${url} ...`);
  await migrate(db, { migrationsFolder: "./drizzle" });
  console.log("Migrations applied.");
  client.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
