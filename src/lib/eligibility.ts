import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { computeEconomics, feasibilityScore } from "@/lib/yield";
import type { VerificationDifficulty } from "@/lib/discovery/types";

// Domain D — the eligibility validator. Pure `evaluateEligibility` decides
// whether a user can pursue an offer and, if so, computes the capital-days
// economics (reusing @/lib/yield). `recomputeEligibility` runs it across all
// active offers and materializes user_offer_eligibility rows.

const DEFAULT_MARGINAL_RATE_BPS = 3200; // 32% blended fed+state marginal rate

type OfferRow = typeof schema.offer.$inferSelect;
type RequirementRow = typeof schema.requirement.$inferSelect;
type DisqualifierRow = typeof schema.disqualifier.$inferSelect;
type GeoRow = typeof schema.geoEligibility.$inferSelect;
type ProductRow = typeof schema.product.$inferSelect;

export interface EligibilityContext {
  userState?: string;
  maxOpenAccounts?: number;
  /** Institution IDs the user already banks with (excludes existing-customer offers). */
  existingInstitutionIds: Set<string>;
  /** Count of account_open events in the last 12 months (velocity governor). */
  recentAccountOpens: number;
  /** Institution IDs with a prior campaign (prior-bonus lookback). */
  priorCampaignInstitutionIds: Set<string>;
  offer: OfferRow;
  product?: ProductRow | null;
  requirements: RequirementRow[];
  disqualifiers: DisqualifierRow[];
  geo: GeoRow[];
  marginalRateBps?: number;
}

export interface EligibilityResult {
  status: "eligible" | "ineligible" | "needs_review";
  blockingDisqualifierIds: string[];
  reasons: string[];
  requiredCapitalCents: number;
  holdDays: number;
  expectedGrossBonusCents: number;
  economics: ReturnType<typeof computeEconomics>;
  feasibility: number;
}

const DIFFICULTY_RANK: Record<VerificationDifficulty, number> = {
  deterministic: 0,
  probabilistic: 1,
  opaque: 2,
};

/** The hardest (least verifiable) gating requirement drives feasibility. */
function hardestDifficulty(reqs: RequirementRow[]): VerificationDifficulty {
  let worst: VerificationDifficulty = "deterministic";
  for (const r of reqs) {
    const d = (r.verificationDifficulty ?? "deterministic") as VerificationDifficulty;
    if (DIFFICULTY_RANK[d] > DIFFICULTY_RANK[worst]) worst = d;
  }
  return worst;
}

/**
 * Capital the user must tie up. The binding constraint across the requirement
 * tree: the largest balance/new-money hold, the DD throughput needed, or the
 * product's minimum opening deposit — whichever is greatest.
 */
function deriveRequiredCapitalCents(ctx: EligibilityContext): number {
  let capital = ctx.product?.minOpeningDepositCents ?? 0;
  for (const r of ctx.requirements) {
    const amt = r.targetAmountCents ?? 0;
    if (
      r.requirementType === "min_balance_avg_daily" ||
      r.requirementType === "min_balance_point_in_time" ||
      r.requirementType === "new_money_deposit" ||
      r.requirementType === "direct_deposit_cumulative"
    ) {
      capital = Math.max(capital, amt);
    }
  }
  return capital || 100_00; // fall back to $100 so annualized math is defined
}

export function evaluateEligibility(ctx: EligibilityContext): EligibilityResult {
  const reasons: string[] = [];
  const blocking: string[] = [];
  const state = ctx.userState?.toUpperCase();

  // --- Geo gating -------------------------------------------------------
  const eligibleStates = ctx.geo
    .filter((g) => g.eligibility === "eligible")
    .map((g) => g.stateCode.toUpperCase());
  const ineligibleStates = ctx.geo
    .filter((g) => g.eligibility === "ineligible")
    .map((g) => g.stateCode.toUpperCase());

  if (state) {
    if (ineligibleStates.includes(state)) {
      reasons.push(`Not available in ${state}.`);
    }
    // A non-empty eligible allowlist means "these states only".
    if (eligibleStates.length > 0 && !eligibleStates.includes(state)) {
      reasons.push(`Offer footprint excludes ${state}.`);
    }
  }

  // --- Disqualifiers ----------------------------------------------------
  for (const dq of ctx.disqualifiers) {
    switch (dq.disqualifierType) {
      case "state_excluded": {
        if (state && dq.excludedStates?.map((s) => s.toUpperCase()).includes(state)) {
          blocking.push(dq.id);
          reasons.push(dq.detail ?? `Excluded in ${state}.`);
        }
        if (
          state &&
          dq.includedStatesOnly?.length &&
          !dq.includedStatesOnly.map((s) => s.toUpperCase()).includes(state)
        ) {
          blocking.push(dq.id);
          reasons.push(dq.detail ?? `Only available in select states (not ${state}).`);
        }
        break;
      }
      case "existing_customer": {
        if (ctx.existingInstitutionIds.has(ctx.offer.institutionId)) {
          blocking.push(dq.id);
          reasons.push("You already bank here (existing-customer exclusion).");
        }
        break;
      }
      case "prior_bonus_lookback": {
        if (ctx.priorCampaignInstitutionIds.has(ctx.offer.institutionId)) {
          blocking.push(dq.id);
          reasons.push("You've pursued a prior bonus at this institution.");
        }
        break;
      }
      // closed_account_lookback / employee / business / age / ssn / tax:
      // assumed clear for a standard US-person profile without more data.
      default:
        break;
    }
  }

  // --- Velocity (ChexSystems) ------------------------------------------
  let needsReview = false;
  if (ctx.maxOpenAccounts != null && ctx.recentAccountOpens >= ctx.maxOpenAccounts) {
    needsReview = true;
    reasons.push(
      `At your self-imposed velocity cap (${ctx.recentAccountOpens}/${ctx.maxOpenAccounts} opens in 12mo).`,
    );
  }

  // --- Economics --------------------------------------------------------
  const requiredCapitalCents = deriveRequiredCapitalCents(ctx);
  const holdDays = ctx.offer.requirementWindowDays ?? 90;
  const marginalRateBps = ctx.marginalRateBps ?? DEFAULT_MARGINAL_RATE_BPS;
  const expectedGrossBonusCents = ctx.offer.bonusAmountCents ?? 0;

  // promo_apy offers earn interest rather than a fixed bonus.
  const interestCents =
    ctx.offer.bonusType === "promo_apy" && ctx.offer.bonusApyBps
      ? Math.round((requiredCapitalCents * ctx.offer.bonusApyBps * holdDays) / (10_000 * 365))
      : 0;

  const feasibility = feasibilityScore({ ddDifficulty: hardestDifficulty(ctx.requirements) });
  const economics = computeEconomics({
    bonusCents: expectedGrossBonusCents,
    interestCents,
    feesCents: 0,
    capitalCents: requiredCapitalCents,
    holdDays,
    marginalRateBps,
    feasibility,
  });

  const status: EligibilityResult["status"] =
    blocking.length > 0 || reasons.some((r) => r.includes("footprint") || r.includes("Not available"))
      ? "ineligible"
      : needsReview
        ? "needs_review"
        : "eligible";

  return {
    status,
    blockingDisqualifierIds: blocking,
    reasons,
    requiredCapitalCents,
    holdDays,
    expectedGrossBonusCents,
    economics,
    feasibility,
  };
}

/**
 * Recompute eligibility for one user across all active offers and rewrite the
 * user_offer_eligibility rows. Returns a summary count.
 */
export async function recomputeEligibility(userId: string): Promise<{
  evaluated: number;
  eligible: number;
  ineligible: number;
  needsReview: number;
}> {
  // Load user context.
  const [addr] = await db
    .select()
    .from(schema.userAddress)
    .where(and(eq(schema.userAddress.userId, userId), eq(schema.userAddress.isCurrent, true)))
    .limit(1);
  const [user] = await db
    .select()
    .from(schema.userProfile)
    .where(eq(schema.userProfile.id, userId))
    .limit(1);

  const existingAccounts = await db
    .select({ institutionId: schema.linkedAccount.institutionId })
    .from(schema.linkedAccount)
    .where(eq(schema.linkedAccount.userId, userId));
  const existingInstitutionIds = new Set(existingAccounts.map((a) => a.institutionId));

  const priorCampaigns = await db
    .select({ offerId: schema.campaign.offerId })
    .from(schema.campaign)
    .where(eq(schema.campaign.userId, userId));
  const priorOfferIds = priorCampaigns.map((c) => c.offerId);

  const chexOpens = await db
    .select({ id: schema.chexsystemsEvent.id })
    .from(schema.chexsystemsEvent)
    .where(
      and(
        eq(schema.chexsystemsEvent.userId, userId),
        eq(schema.chexsystemsEvent.eventType, "account_open"),
      ),
    );

  // All active offers with their product + requirement tree + gates.
  const offers = await db
    .select({ offer: schema.offer, product: schema.product })
    .from(schema.offer)
    .leftJoin(schema.product, eq(schema.offer.productId, schema.product.id))
    .where(eq(schema.offer.status, "active"));

  // Map prior offers -> institution for prior-bonus lookback.
  const priorCampaignInstitutionIds = new Set(
    offers.filter((o) => priorOfferIds.includes(o.offer.id)).map((o) => o.offer.institutionId),
  );

  // Clear existing eligibility for this user, then recompute fresh.
  await db.delete(schema.userOfferEligibility).where(eq(schema.userOfferEligibility.userId, userId));

  let eligible = 0;
  let ineligible = 0;
  let needsReview = 0;

  for (const { offer, product } of offers) {
    const requirements = await db
      .select()
      .from(schema.requirement)
      .innerJoin(
        schema.requirementGroup,
        eq(schema.requirement.requirementGroupId, schema.requirementGroup.id),
      )
      .where(eq(schema.requirementGroup.offerId, offer.id));
    const requirementRows = requirements.map((r) => r.requirement);

    const disqualifiers = await db
      .select()
      .from(schema.disqualifier)
      .where(eq(schema.disqualifier.offerId, offer.id));

    const geo = await db
      .select()
      .from(schema.geoEligibility)
      .where(eq(schema.geoEligibility.offerId, offer.id));

    const result = evaluateEligibility({
      userState: addr?.state ?? undefined,
      maxOpenAccounts: user?.maxOpenAccounts ?? undefined,
      existingInstitutionIds,
      recentAccountOpens: chexOpens.length,
      priorCampaignInstitutionIds,
      offer,
      product,
      requirements: requirementRows,
      disqualifiers,
      geo,
    });

    if (result.status === "eligible") eligible++;
    else if (result.status === "needs_review") needsReview++;
    else ineligible++;

    await db.insert(schema.userOfferEligibility).values({
      userId,
      offerId: offer.id,
      eligibilityStatus: result.status,
      blockingDisqualifierIds: result.blockingDisqualifierIds,
      computedAt: new Date(),
      expectedGrossBonusCents: result.expectedGrossBonusCents,
      requiredCapitalCents: result.requiredCapitalCents,
      capitalDays: result.economics.capitalDays,
      projectedAnnualizedYieldBps: result.economics.projectedAnnualizedYieldBps,
      projectedNetAfterTaxBps: result.economics.projectedNetAfterTaxBps,
      feasibilityScore: result.feasibility,
      rankScore: result.economics.rankScore,
    });
  }

  return { evaluated: offers.length, eligible, ineligible, needsReview };
}
