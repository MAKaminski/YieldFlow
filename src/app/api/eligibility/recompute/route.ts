import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { recomputeEligibility } from "@/lib/eligibility";

export const dynamic = "force-dynamic";

// POST /api/eligibility/recompute — re-evaluate all active offers for the demo
// user and rewrite user_offer_eligibility rows. Returns the eligible/ineligible
// breakdown.
export async function POST() {
  const [demo] = await db
    .select({ id: schema.userProfile.id })
    .from(schema.userProfile)
    .where(eq(schema.userProfile.email, "demo@yieldflow.app"))
    .limit(1);

  if (!demo) {
    return NextResponse.json({ error: "demo user not found" }, { status: 404 });
  }

  const result = await recomputeEligibility(demo.id);
  return NextResponse.json(result);
}
