import { NextResponse } from "next/server";
import { getRankedOffers } from "@/lib/queries";

export const dynamic = "force-dynamic";

// GET /api/offers — offers ranked by risk-adjusted after-tax annualized yield.
export async function GET() {
  const rows = await getRankedOffers();
  const offers = rows.map(({ offer, institution, product, eligibility }) => ({
    id: offer.id,
    title: offer.title,
    institution: institution.brandName,
    product: product?.productName ?? null,
    bonusType: offer.bonusType,
    bonusAmountCents: offer.bonusAmountCents,
    bonusApyBps: offer.bonusApyBps,
    isTargeted: offer.isTargeted,
    status: offer.status,
    offerEndDate: offer.offerEndDate,
    applicationChannel: offer.applicationChannel,
    applicationUrl: offer.applicationUrl,
    applicationUrlVerified: offer.applicationUrlVerified,
    // True only when the agent can drive this in a browser AND the link is
    // verified-resolving (so we never steer the user to a dead/404 apply page).
    webOpenable:
      offer.applicationChannel === "web" &&
      !!offer.applicationUrl &&
      !!offer.applicationUrlVerified,
    economics: eligibility
      ? {
          requiredCapitalCents: eligibility.requiredCapitalCents,
          capitalDays: eligibility.capitalDays,
          projectedAnnualizedYieldBps: eligibility.projectedAnnualizedYieldBps,
          projectedNetAfterTaxBps: eligibility.projectedNetAfterTaxBps,
          feasibilityScore: eligibility.feasibilityScore,
          rankScore: eligibility.rankScore,
        }
      : null,
  }));

  return NextResponse.json({ count: offers.length, offers });
}
