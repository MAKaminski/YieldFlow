import "dotenv/config";
import { eq } from "drizzle-orm";
import { db, schema } from "./index";
import { curatedProvider } from "../lib/discovery/provider";
import { ingestOffers } from "../lib/discovery/ingest";
import { verifyApplicationLinks } from "../lib/discovery/verify-links";
import { recomputeEligibility } from "../lib/eligibility";

// Run discovery: ingest the curated public-offer snapshot (additive — existing
// demo data survives), then recompute eligibility for the demo user and print a
// summary. Run against Turso in prod: `npm run db:discover`.

async function main() {
  const dataset = await curatedProvider.fetch();

  const result = await ingestOffers(dataset, {
    sourceType: "aggregator",
    sourceName: "curated public trackers (DoC / NerdWallet / Bankrate / CNBC)",
    baseUrl: "https://www.doctorofcredit.com/best-bank-account-bonuses/",
    trustScore: 0.85,
  });

  console.log(
    `Discovery: ${result.offersFound} found, ${result.offersNew} new, ` +
      `${result.offersUpdated} updated (dedup-skipped ${result.skipped}).`,
  );

  // Validate every application link resolves (catches dead/homepage links).
  const links = await verifyApplicationLinks();
  console.log(`Links: ${links.verified}/${links.checked} verified.`);
  for (const f of links.failed) {
    console.log(`  ⚠️  unverified link: ${f.title} → ${f.url ?? "(none)"}`);
  }

  // Ensure the demo user exists + has a home state and a velocity cap.
  const [demo] = await db
    .select()
    .from(schema.userProfile)
    .where(eq(schema.userProfile.email, "demo@yieldflow.app"))
    .limit(1);

  if (!demo) {
    console.error("Demo user not found — run `npm run db:seed` first.");
    process.exit(1);
  }

  if (demo.maxOpenAccounts == null) {
    await db
      .update(schema.userProfile)
      .set({ maxOpenAccounts: 6, kycStatus: "verified" })
      .where(eq(schema.userProfile.id, demo.id));
  }

  const elig = await recomputeEligibility(demo.id);
  console.log(
    `Eligibility (demo user, GA): ${elig.eligible} eligible, ` +
      `${elig.needsReview} needs-review, ${elig.ineligible} ineligible ` +
      `of ${elig.evaluated} active offers.`,
  );

  if (elig.eligible < 15) {
    console.warn(`⚠️  Fewer than 15 eligible offers (${elig.eligible}).`);
  } else {
    console.log(`✅  ${elig.eligible} offers the user is eligible for.`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
