import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { getCampaigns } from "@/lib/queries";
import { startCampaign } from "@/lib/orchestration";

export const dynamic = "force-dynamic";

// POST /api/campaigns — start a campaign for an offer (the CLI entry point that
// mirrors the "Start campaign" button). Creates the campaign + task plan for the
// demo user; no money moves. Returns { campaignId }.
const startBody = z.object({ offerId: z.string().min(1) });

export async function POST(req: Request) {
  const parsed = startBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "offerId is required" }, { status: 400 });
  }

  const [user] = await db
    .select({ id: schema.userProfile.id })
    .from(schema.userProfile)
    .where(eq(schema.userProfile.email, "demo@yieldflow.app"))
    .limit(1);
  if (!user) {
    return NextResponse.json(
      { error: "Demo user not found — run `npm run db:seed`." },
      { status: 404 },
    );
  }

  try {
    const campaignId = await startCampaign(user.id, parsed.data.offerId);
    return NextResponse.json({ campaignId }, { status: 201 });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "failed to start campaign" },
      { status: 400 },
    );
  }
}

// GET /api/campaigns — campaigns with per-requirement progress.
export async function GET() {
  const rows = await getCampaigns();
  const campaigns = rows.map(({ campaign, offer, institution, progress }) => ({
    id: campaign.id,
    offer: { id: offer.id, title: offer.title, institution: institution.brandName },
    status: campaign.status,
    requirementsDeadline: campaign.requirementsDeadline,
    earliestSafeCloseDate: campaign.earliestSafeCloseDate,
    expectedBonusCents: campaign.expectedBonusCents,
    capitalCommittedCents: campaign.capitalCommittedCents,
    progress: progress.map(({ progress: p, requirement }) => ({
      requirementType: requirement.requirementType,
      status: p.status,
      targetAmountCents: p.targetAmountCents,
      accruedAmountCents: p.accruedAmountCents,
      confidence: p.confidence,
    })),
  }));

  return NextResponse.json({ count: campaigns.length, campaigns });
}
