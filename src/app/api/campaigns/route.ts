import { NextResponse } from "next/server";
import { getCampaigns } from "@/lib/queries";

export const dynamic = "force-dynamic";

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
