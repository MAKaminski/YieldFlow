import { defineConfig } from "drizzle-kit";

const url = process.env.DATABASE_URL ?? "file:local.db";
const authToken = process.env.DATABASE_AUTH_TOKEN || undefined;

export default defineConfig({
  dialect: "turso",
  schema: "./src/db/schema/index.ts",
  out: "./drizzle",
  dbCredentials: { url, authToken },
  casing: "snake_case",
  verbose: true,
  strict: true,
});
