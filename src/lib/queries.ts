import { asc, desc, eq } from "drizzle-orm";
import { db, schema } from "@/db";

// Read-only data-access helpers shared by the App Router pages and the API
// route handlers. Everything here runs on the server against Drizzle/libSQL.

export type RankedOffer = Awaited<ReturnType<typeof getRankedOffers>>[number];
export type CampaignDetail = NonNullable<
  Awaited<ReturnType<typeof getCampaignDetail>>
>;

/** Offers joined to institution/product and the demo user's eligibility, ranked. */
export async function getRankedOffers() {
  try {
    return await getRankedOffersInner();
  } catch (err) {
    // No database wired yet (e.g. Turso env vars not set on Vercel) — render an
    // empty shell rather than a 500.
    console.error("getRankedOffers failed:", err);
    return [];
  }
}

async function getRankedOffersInner() {
  const rows = await db
    .select({
      offer: schema.offer,
      institution: schema.institution,
      product: schema.product,
      eligibility: schema.userOfferEligibility,
    })
    .from(schema.offer)
    .innerJoin(
      schema.institution,
      eq(schema.offer.institutionId, schema.institution.id),
    )
    .leftJoin(schema.product, eq(schema.offer.productId, schema.product.id))
    .leftJoin(
      schema.userOfferEligibility,
      eq(schema.userOfferEligibility.offerId, schema.offer.id),
    );

  return rows.sort(
    (a, b) => (b.eligibility?.rankScore ?? 0) - (a.eligibility?.rankScore ?? 0),
  );
}

/** Full detail for one offer: requirement tree, disqualifiers, geo, eligibility. */
export async function getOfferDetail(offerId: string) {
  try {
    return await getOfferDetailInner(offerId);
  } catch (err) {
    console.error("getOfferDetail failed:", err);
    return null;
  }
}

async function getOfferDetailInner(offerId: string) {
  const [head] = await db
    .select({
      offer: schema.offer,
      institution: schema.institution,
      product: schema.product,
      eligibility: schema.userOfferEligibility,
    })
    .from(schema.offer)
    .innerJoin(
      schema.institution,
      eq(schema.offer.institutionId, schema.institution.id),
    )
    .leftJoin(schema.product, eq(schema.offer.productId, schema.product.id))
    .leftJoin(
      schema.userOfferEligibility,
      eq(schema.userOfferEligibility.offerId, schema.offer.id),
    )
    .where(eq(schema.offer.id, offerId))
    .limit(1);

  if (!head) return null;

  const groups = await db
    .select()
    .from(schema.requirementGroup)
    .where(eq(schema.requirementGroup.offerId, offerId));

  const requirements = groups.length
    ? await db.select().from(schema.requirement)
    : [];

  const groupIds = new Set(groups.map((g) => g.id));
  const groupedRequirements = groups.map((group) => ({
    group,
    requirements: requirements.filter(
      (r) => r.requirementGroupId === group.id && groupIds.has(group.id),
    ),
  }));

  const disqualifiers = await db
    .select()
    .from(schema.disqualifier)
    .where(eq(schema.disqualifier.offerId, offerId));

  const geo = await db
    .select()
    .from(schema.geoEligibility)
    .where(eq(schema.geoEligibility.offerId, offerId));

  return { ...head, groupedRequirements, disqualifiers, geo };
}

/** Campaigns with their offer + institution and per-requirement progress. */
export async function getCampaigns() {
  try {
    return await getCampaignsInner();
  } catch (err) {
    console.error("getCampaigns failed:", err);
    return [];
  }
}

async function getCampaignsInner() {
  const rows = await db
    .select({
      campaign: schema.campaign,
      offer: schema.offer,
      institution: schema.institution,
    })
    .from(schema.campaign)
    .innerJoin(schema.offer, eq(schema.campaign.offerId, schema.offer.id))
    .innerJoin(
      schema.institution,
      eq(schema.offer.institutionId, schema.institution.id),
    )
    .orderBy(desc(schema.campaign.createdAt));

  const withProgress = await Promise.all(
    rows.map(async (row) => {
      const progress = await db
        .select({
          progress: schema.campaignRequirementProgress,
          requirement: schema.requirement,
        })
        .from(schema.campaignRequirementProgress)
        .innerJoin(
          schema.requirement,
          eq(schema.campaignRequirementProgress.requirementId, schema.requirement.id),
        )
        .where(eq(schema.campaignRequirementProgress.campaignId, row.campaign.id));
      return { ...row, progress };
    }),
  );

  return withProgress;
}

/** Full cockpit detail for one campaign: offer, tasks, progress, transfer plan. */
export async function getCampaignDetail(campaignId: string) {
  try {
    return await getCampaignDetailInner(campaignId);
  } catch (err) {
    console.error("getCampaignDetail failed:", err);
    return null;
  }
}

async function getCampaignDetailInner(campaignId: string) {
  const [head] = await db
    .select({
      campaign: schema.campaign,
      offer: schema.offer,
      institution: schema.institution,
      product: schema.product,
    })
    .from(schema.campaign)
    .innerJoin(schema.offer, eq(schema.campaign.offerId, schema.offer.id))
    .innerJoin(schema.institution, eq(schema.offer.institutionId, schema.institution.id))
    .leftJoin(schema.product, eq(schema.offer.productId, schema.product.id))
    .where(eq(schema.campaign.id, campaignId))
    .limit(1);
  if (!head) return null;

  const tasks = await db
    .select()
    .from(schema.campaignTask)
    .where(eq(schema.campaignTask.campaignId, campaignId))
    .orderBy(asc(schema.campaignTask.createdAt));

  const progress = await db
    .select({
      progress: schema.campaignRequirementProgress,
      requirement: schema.requirement,
    })
    .from(schema.campaignRequirementProgress)
    .innerJoin(
      schema.requirement,
      eq(schema.campaignRequirementProgress.requirementId, schema.requirement.id),
    )
    .where(eq(schema.campaignRequirementProgress.campaignId, campaignId));

  // The most recent transfer plan for this user + its legs.
  const plans = await db
    .select()
    .from(schema.transferPlan)
    .where(eq(schema.transferPlan.userId, head.campaign.userId))
    .orderBy(desc(schema.transferPlan.createdAt))
    .limit(1);
  const plan = plans[0] ?? null;
  const legs = plan
    ? await db
        .select()
        .from(schema.transferLeg)
        .where(eq(schema.transferLeg.transferPlanId, plan.id))
        .orderBy(asc(schema.transferLeg.sequence))
    : [];

  return { ...head, tasks, progress, plan, legs };
}
