import { drizzle } from "drizzle-orm/libsql";
import { createClient } from "@libsql/client";
import * as schema from "./schema";
import { resolveDbCredentials } from "./env";

const { url, authToken } = resolveDbCredentials();

/**
 * libSQL client — a `file:` URL locally, a remote `libsql://` Turso URL in
 * production. A single libSQL client is safe to reuse across serverless
 * invocations, so we cache it on globalThis to avoid re-creating it on every
 * hot-reload / lambda warm start.
 */
const globalForDb = globalThis as unknown as {
  __yieldflowClient?: ReturnType<typeof createClient>;
};

const client =
  globalForDb.__yieldflowClient ?? createClient({ url, authToken });

if (process.env.NODE_ENV !== "production") {
  globalForDb.__yieldflowClient = client;
}

export const db = drizzle(client, { schema, casing: "snake_case" });
export { schema };
export type Db = typeof db;
