import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";

export const dynamic = "force-dynamic";

// GET /go/[offerId] — first-party outbound click redirector. Logs the click for
// attribution, then 302s to the affiliate link (revenue) when we have one, else
// the plain application URL. Every monetizable "Open application" CTA points
// here so clicks are measurable and affiliate links are swappable without
// touching the offer data.
export async function GET(
  req: Request,
  { params }: { params: Promise<{ offerId: string }> },
) {
  const { offerId } = await params;

  const [offer] = await db
    .select({
      id: schema.offer.id,
      affiliateUrl: schema.offer.affiliateUrl,
      applicationUrl: schema.offer.applicationUrl,
      termsUrl: schema.offer.termsUrl,
    })
    .from(schema.offer)
    .where(eq(schema.offer.id, offerId))
    .limit(1);

  if (!offer) {
    return NextResponse.redirect(new URL("/", req.url), 302);
  }

  // Attribution: record the outbound click (reuses the audit_log table).
  const usedAffiliate = !!offer.affiliateUrl;
  try {
    await db.insert(schema.auditLog).values({
      actorType: "user",
      action: "offer_click",
      entityType: "offer",
      entityId: offer.id,
      afterJson: { usedAffiliate },
      occurredAt: new Date(),
    });
  } catch {
    // never block the redirect on logging
  }

  const target = offer.affiliateUrl ?? offer.applicationUrl ?? offer.termsUrl;
  if (!target) {
    return NextResponse.redirect(new URL(`/offers/${offer.id}`, req.url), 302);
  }
  return NextResponse.redirect(target, 302);
}
