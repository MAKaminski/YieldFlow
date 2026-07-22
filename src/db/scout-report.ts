import { eq } from "drizzle-orm";
import { db, schema } from "@/db";

// Per-bank live-DOM probe results (populated by `npm run db:scout`). Prints, for
// each active web offer, what the real headless browser saw at the application
// URL: captured (a real form + fields), blocked (bank refused the datacenter
// browser — expected), or error. This is the empirical "did we reach the live
// form" signal, distinct from the entry-path check (db:verify-banks).
async function main() {
  const rows = await db
    .select({
      brand: schema.institution.brandName,
      channel: schema.offer.applicationChannel,
      status: schema.offer.scoutStatus,
      fields: schema.offer.scoutFields,
      verified: schema.offer.applicationUrlVerified,
    })
    .from(schema.offer)
    .innerJoin(schema.institution, eq(schema.offer.institutionId, schema.institution.id))
    .where(eq(schema.offer.status, "active"));

  const icon = (s: string | null) =>
    s === "captured" ? "✓ captured" : s === "blocked" ? "⛔ blocked" : s === "error" ? "⚠ error" : "· not scouted";

  let cap = 0;
  let blk = 0;
  let err = 0;
  for (const r of rows) {
    if (r.channel !== "web") continue;
    if (r.status === "captured") cap++;
    else if (r.status === "blocked") blk++;
    else if (r.status === "error") err++;
    const fcount = Array.isArray(r.fields) ? (r.fields as string[]).length : 0;
    console.log(
      `  ${(r.brand ?? "").padEnd(18)} ${icon(r.status ?? null).padEnd(13)} ` +
        `${fcount ? `${fcount} fields observed` : ""}`,
    );
  }
  const app = rows.filter((r) => r.channel !== "web").length;
  console.log(
    `\nweb: ${cap} captured · ${blk} blocked · ${err} error   (${app} app-only handoff)`,
  );
  console.log(
    "blocked = the bank refused the datacenter/headless browser (expected). It does NOT\n" +
      "mean the offer is broken — the agent runs in the USER's real Chrome, where these load.",
  );
  process.exit(0);
}
main();
