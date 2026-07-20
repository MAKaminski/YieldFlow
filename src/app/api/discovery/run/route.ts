import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { curatedProvider } from "@/lib/discovery/provider";
import { ingestOffers } from "@/lib/discovery/ingest";
import { recomputeEligibility } from "@/lib/eligibility";

export const dynamic = "force-dynamic";

// POST /api/discovery/run — re-run discovery (additive) + recompute eligibility
// for the demo user. Optionally guarded by ADMIN_TOKEN (send as x-admin-token).
export async function POST(req: Request) {
  const required = process.env.ADMIN_TOKEN;
  if (required && req.headers.get("x-admin-token") !== required) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const dataset = await curatedProvider.fetch();
  const ingest = await ingestOffers(dataset, {
    sourceType: "aggregator",
    sourceName: "curated public trackers (DoC / NerdWallet / Bankrate / CNBC)",
    baseUrl: "https://www.doctorofcredit.com/best-bank-account-bonuses/",
    trustScore: 0.85,
  });

  const [demo] = await db
    .select({ id: schema.userProfile.id })
    .from(schema.userProfile)
    .where(eq(schema.userProfile.email, "demo@yieldflow.app"))
    .limit(1);

  const eligibility = demo ? await recomputeEligibility(demo.id) : null;

  return NextResponse.json({ ingest, eligibility });
}
