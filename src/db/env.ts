/**
 * Resolve libSQL credentials from the environment, accepting both naming
 * conventions:
 *   - DATABASE_URL / DATABASE_AUTH_TOKEN   (our own .env)
 *   - TURSO_DATABASE_URL / TURSO_AUTH_TOKEN (injected by the Turso–Vercel
 *     native integration)
 *
 * Falls back to a local SQLite file so `npm run dev` works with zero config.
 */
export function resolveDbCredentials(): { url: string; authToken?: string } {
  const url =
    process.env.DATABASE_URL ?? process.env.TURSO_DATABASE_URL ?? "file:local.db";
  const authToken =
    process.env.DATABASE_AUTH_TOKEN || process.env.TURSO_AUTH_TOKEN || undefined;
  return { url, authToken };
}
