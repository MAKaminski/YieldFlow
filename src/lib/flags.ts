import { eq } from "drizzle-orm";
import { db, schema } from "@/db";

// Operational feature flags, stored in the `feature_flag` table and toggled from
// the /admin page. Keep the canonical list here so the admin page can render a
// flag even before it's been written to the DB, and so callers get a typed key.

export type FlagKey = "business_accounts";

interface FlagDef {
  key: FlagKey;
  label: string;
  description: string;
  /** Value used when the row doesn't exist yet (first boot). */
  defaultEnabled: boolean;
}

/** The known flags. New features register here. */
export const FLAG_DEFS: FlagDef[] = [
  {
    key: "business_accounts",
    label: "Business accounts",
    description:
      "Show the Business tab and business-audience offers (business checking bonuses need a KYB payload). Off by default until the feature is ready to launch.",
    defaultEnabled: false,
  },
];

/** True if a flag is enabled. Unknown/absent rows fall back to the registered default. */
export async function isFlagEnabled(key: FlagKey): Promise<boolean> {
  const [row] = await db
    .select({ enabled: schema.featureFlag.enabled })
    .from(schema.featureFlag)
    .where(eq(schema.featureFlag.key, key))
    .limit(1);
  if (row) return row.enabled;
  return FLAG_DEFS.find((f) => f.key === key)?.defaultEnabled ?? false;
}

/** All flags for the admin page — merges DB state over the registered defaults. */
export async function getAllFlags(): Promise<
  { key: FlagKey; label: string; description: string; enabled: boolean }[]
> {
  const rows = await db.select().from(schema.featureFlag);
  const byKey = new Map(rows.map((r) => [r.key, r]));
  return FLAG_DEFS.map((def) => {
    const row = byKey.get(def.key);
    return {
      key: def.key,
      label: def.label,
      description: def.description,
      enabled: row ? row.enabled : def.defaultEnabled,
    };
  });
}

/** Toggle/set a flag, upserting the row. Returns the new value. */
export async function setFlag(key: FlagKey, enabled: boolean): Promise<boolean> {
  const def = FLAG_DEFS.find((f) => f.key === key);
  const [existing] = await db
    .select({ id: schema.featureFlag.id })
    .from(schema.featureFlag)
    .where(eq(schema.featureFlag.key, key))
    .limit(1);
  if (existing) {
    await db
      .update(schema.featureFlag)
      .set({ enabled })
      .where(eq(schema.featureFlag.key, key));
  } else {
    await db.insert(schema.featureFlag).values({
      key,
      enabled,
      label: def?.label,
      description: def?.description,
    });
  }
  return enabled;
}

/** Ensure a row exists for every registered flag (called by the seed). */
export async function seedFlags(): Promise<void> {
  const rows = await db.select({ key: schema.featureFlag.key }).from(schema.featureFlag);
  const have = new Set(rows.map((r) => r.key));
  const missing = FLAG_DEFS.filter((f) => !have.has(f.key));
  if (missing.length) {
    await db.insert(schema.featureFlag).values(
      missing.map((f) => ({
        key: f.key,
        enabled: f.defaultEnabled,
        label: f.label,
        description: f.description,
      })),
    );
  }
}
