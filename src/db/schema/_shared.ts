import { integer, text } from "drizzle-orm/sqlite-core";

/**
 * Postgres -> SQLite/libSQL type translations used across every domain.
 *
 * The source ERD is written in Postgres types (uuid, timestamptz, jsonb,
 * arrays, bigint, numeric). SQLite has none of those natively, so:
 *   - uuid PK           -> text, defaulted with crypto.randomUUID()
 *   - timestamptz       -> integer (unix seconds), mapped to JS Date
 *   - enum              -> text with a typed { enum: [...] } union
 *   - uuid[] / text[]   -> json-mode text column typed as string[]
 *   - jsonb             -> json-mode text column
 *   - bigint cents      -> integer (JS number is exact to 2^53; fine for cents)
 *   - numeric(3,2)      -> real
 */

/** UUID text primary key, generated app-side. */
export const pk = () =>
  text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID());

/** created_at / updated_at as unix-second timestamps, spread into every table. */
export const timestamps = () => ({
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date())
    .$onUpdate(() => new Date()),
});

/** A json-encoded array of strings (uuid[], char(2)[], text[]). */
export const jsonStringArray = (name: string) =>
  text(name, { mode: "json" }).$type<string[]>();
