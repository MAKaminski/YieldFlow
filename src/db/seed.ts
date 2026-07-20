import "dotenv/config";
import { eq } from "drizzle-orm";
import { db, schema } from "./index";
import { computeEconomics, feasibilityScore } from "../lib/yield";

/**
 * Seeds the full "Regions LifeGreen Preferred Checking" trigger artifact
 * end-to-end so the app has real, inspectable data on first load:
 *
 *   institution -> products + rate tiers -> offers -> AND/OR requirement tree
 *   -> disqualifiers + geo eligibility -> demo user -> linked accounts
 *   -> a live campaign with per-requirement progress -> computed eligibility.
 *
 * Idempotent: every table is cleared (child -> parent order) before insert, so
 * it can be re-run safely (`npm run db:seed`).
 */

const d = (iso: string) => new Date(iso + "T00:00:00Z");
const usd = (dollars: number) => Math.round(dollars * 100); // -> cents

async function clearAll() {
  // Delete in FK-safe order (children before parents).
  const order = [
    schema.requirementEvidence,
    schema.campaignRequirementProgress,
    schema.campaignTask,
    schema.bonusPayout,
    schema.campaign,
    schema.transferLeg,
    schema.transferPlan,
    schema.fdicExposure,
    schema.accountBalanceSnapshot,
    schema.transaction,
    schema.linkedAccount,
    schema.userOfferEligibility,
    schema.chexsystemsEvent,
    schema.userCredentialRef,
    schema.userAddress,
    schema.taxLot,
    schema.performancePeriod,
    schema.consentRecord,
    schema.approvalRequest,
    schema.notification,
    schema.agentDecision,
    schema.agentRun,
    schema.auditLog,
    schema.userProfile,
    schema.geoEligibility,
    schema.disqualifier,
    schema.requirement,
    schema.requirementGroup,
    schema.offerChangeLog,
    schema.offer,
    schema.offerRawDocument,
    schema.offerIngestRun,
    schema.offerSource,
    schema.rateTier,
    schema.product,
    schema.institutionFootprint,
    schema.institution,
  ];
  for (const table of order) {
    await db.delete(table);
  }
}

async function seed() {
  await clearAll();

  // --- Domain A: Institution + products -----------------------------------
  const [regions] = await db
    .insert(schema.institution)
    .values({
      legalName: "Regions Bank",
      brandName: "Regions",
      rssdId: "233031",
      fdicCertId: "12368",
      primaryAbaRouting: "062000019",
      charterType: "state_bank",
      hqState: "AL",
      chexsystemsSensitivity: "moderate",
      earlyClosureClawbackDays: 180,
      supportsPlaid: true,
      websiteUrl: "https://www.regions.com",
      status: "active",
    })
    .returning();

  // A handful of footprint rows (Regions is a Southeast/Midwest branch bank).
  await db.insert(schema.institutionFootprint).values(
    ["AL", "FL", "GA", "TN", "TX", "IL", "IN", "IA", "MS", "LA", "AR"].map(
      (stateCode) => ({
        institutionId: regions.id,
        stateCode,
        coverageType: "branch" as const,
      }),
    ),
  );

  const [checking] = await db
    .insert(schema.product)
    .values({
      institutionId: regions.id,
      productName: "LifeGreen Preferred Checking",
      productType: "checking",
      monthlyFeeCents: usd(15),
      minOpeningDepositCents: usd(25),
      standardApyBps: 1, // 0.01%
      isInterestBearing: true,
      accountOpeningUrl: "https://www.regions.com/personal-banking/checking-account",
      requiresBranchVisit: false,
    })
    .returning();

  const [mma] = await db
    .insert(schema.product)
    .values({
      institutionId: regions.id,
      productName: "Regions Premium Money Market",
      productType: "money_market",
      monthlyFeeCents: usd(12),
      minOpeningDepositCents: usd(100),
      standardApyBps: 1, // 0.01%
      isInterestBearing: true,
      accountOpeningUrl: "https://www.regions.com/personal-banking/money-market-account",
    })
    .returning();

  // Rate tiers: standard vs. the 4.15% promo requiring $15k new money.
  await db.insert(schema.rateTier).values([
    {
      productId: mma.id,
      minBalanceCents: 0,
      maxBalanceCents: usd(14_999.99),
      apyBps: 1,
      isPromotional: false,
    },
    {
      productId: mma.id,
      minBalanceCents: usd(15_000),
      maxBalanceCents: null,
      apyBps: 415, // 4.15% APY
      isPromotional: true,
      effectiveFrom: d("2026-07-06"),
      effectiveTo: d("2026-09-04"),
    },
  ]);

  // --- Domain B: Offer source + the two stackable offers ------------------
  const [source] = await db
    .insert(schema.offerSource)
    .values({
      sourceType: "direct_mail",
      sourceName: "Regions LifeGreen mailer (targeted)",
      trustScore: 1.0,
      requiresTargetedMailer: true,
    })
    .returning();

  const [ingestRun] = await db
    .insert(schema.offerIngestRun)
    .values({
      offerSourceId: source.id,
      startedAt: d("2026-07-19"),
      finishedAt: d("2026-07-19"),
      status: "success",
      pagesFetched: 1,
      offersFound: 2,
      offersNew: 2,
      offersUpdated: 0,
    })
    .returning();

  const [rawDoc] = await db
    .insert(schema.offerRawDocument)
    .values({
      offerIngestRunId: ingestRun.id,
      sourceUrl: "direct-mail://regions/MC154",
      contentHash: "sha256:regions-lifegreen-2026-mc154",
      ocrText:
        "Open a LifeGreen Preferred Checking and receive $400 when you make " +
        "qualifying direct deposits of $1,000+ within 90 days. Offer code MC154 / C:P20 T98.",
      capturedAt: d("2026-07-19"),
    })
    .returning();

  const [checkingOffer] = await db
    .insert(schema.offer)
    .values({
      institutionId: regions.id,
      productId: checking.id,
      offerCode: "MC154 / C:P20 T98",
      title: "Regions LifeGreen Preferred Checking — $400 bonus",
      bonusType: "cash",
      bonusAmountCents: usd(400),
      currency: "USD",
      offerEndDate: d("2026-09-04"), // open-by date
      requirementWindowDays: 90,
      payoutWindowDays: 60,
      isTargeted: true,
      targetingChannel: "mail",
      newMoneyRequired: false,
      newCustomerRequired: true,
      customerLookbackMonths: 12,
      termsUrl: "https://www.regions.com/promo/lifegreen-400",
      rawDocumentId: rawDoc.id,
      extractionConfidence: 0.92,
      verificationStatus: "llm_verified",
      status: "active",
    })
    .returning();

  const [mmaOffer] = await db
    .insert(schema.offer)
    .values({
      institutionId: regions.id,
      productId: mma.id,
      offerCode: "MMA-PROMO-415",
      title: "Regions Premium Money Market — 4.15% APY promo",
      bonusType: "promo_apy",
      bonusApyBps: 415,
      currency: "USD",
      offerStartDate: d("2026-07-06"),
      offerEndDate: d("2026-09-04"),
      depositPeriodStart: d("2026-07-06"),
      depositPeriodEnd: d("2026-09-04"),
      isTargeted: true,
      targetingChannel: "mail",
      newMoneyRequired: true,
      newCustomerRequired: false,
      termsUrl: "https://www.regions.com/promo/premium-mma-415",
      rawDocumentId: rawDoc.id,
      extractionConfidence: 0.9,
      verificationStatus: "llm_verified",
      status: "active",
    })
    .returning();

  // Mark the two offers stackable with each other.
  await db
    .update(schema.offer)
    .set({ stackableWithOfferIds: [mmaOffer.id] })
    .where(eq(schema.offer.id, checkingOffer.id));
  await db
    .update(schema.offer)
    .set({ stackableWithOfferIds: [checkingOffer.id] })
    .where(eq(schema.offer.id, mmaOffer.id));

  // --- Domain C: Requirement tree for the checking bonus ------------------
  // Root ALL group: bonus gating (DD) AND fee-waiver (avg daily balance).
  const [rootGroup] = await db
    .insert(schema.requirementGroup)
    .values({
      offerId: checkingOffer.id,
      logicOperator: "ALL",
      sequence: 0,
      description: "All conditions to earn the $400 and avoid the monthly fee",
    })
    .returning();

  await db.insert(schema.requirement).values([
    {
      requirementGroupId: rootGroup.id,
      requirementType: "direct_deposit_cumulative",
      targetAmountCents: usd(1000),
      windowStartAnchor: "account_open",
      windowDays: 90,
      depositSourceConstraint: "payroll_ach",
      isBonusGating: true,
      verificationDifficulty: "probabilistic",
      confidenceNotes:
        "Regions reserves discretion on what codes as a qualifying direct " +
        "deposit; payroll/pension/govt ACH credits count, bank-to-bank pushes often do not.",
    },
    {
      requirementGroupId: rootGroup.id,
      requirementType: "min_balance_avg_daily",
      targetAmountCents: usd(1500),
      windowStartAnchor: "statement_cycle",
      perPeriod: "statement_cycle",
      balanceMeasure: "avg_daily",
      isBonusGating: false, // fee-waiver only
      verificationDifficulty: "deterministic",
      confidenceNotes: "Waives the $15/mo maintenance fee.",
    },
    {
      requirementGroupId: rootGroup.id,
      requirementType: "no_early_closure",
      windowStartAnchor: "account_open",
      windowDays: 180,
      isBonusGating: true,
      verificationDifficulty: "deterministic",
      confidenceNotes: "Clawback if closed within 180 days.",
    },
  ]);

  // Requirement tree for the MMA promo: $15k new money.
  const [mmaGroup] = await db
    .insert(schema.requirementGroup)
    .values({
      offerId: mmaOffer.id,
      logicOperator: "ALL",
      sequence: 0,
      description: "Fund with new-to-Regions money to earn the promo APY",
    })
    .returning();

  await db.insert(schema.requirement).values({
    requirementGroupId: mmaGroup.id,
    requirementType: "new_money_deposit",
    targetAmountCents: usd(15_000),
    windowStartAnchor: "offer_start",
    windowDays: 60,
    depositSourceConstraint: "external_transfer_ok",
    newMoneyLookbackDays: 90,
    isBonusGating: true,
    verificationDifficulty: "deterministic",
    confidenceNotes: "Must be funds not already at Regions in the prior 90 days.",
  });

  // --- Disqualifiers + geo eligibility (checking offer) -------------------
  await db.insert(schema.disqualifier).values([
    {
      offerId: checkingOffer.id,
      disqualifierType: "existing_customer",
      lookbackMonths: 12,
      detail: "Not valid if you held a Regions checking account within 1 year.",
    },
    {
      offerId: checkingOffer.id,
      disqualifierType: "state_excluded",
      excludedStates: ["CA", "NY", "NJ", "CT"],
      detail: "Offer valid only within the Regions branch footprint.",
    },
  ]);

  await db.insert(schema.geoEligibility).values(
    ["AL", "FL", "GA", "TN", "TX", "IL", "IN", "IA", "MS", "LA", "AR"].map(
      (stateCode) => ({
        offerId: checkingOffer.id,
        stateCode,
        eligibility: "eligible" as const,
      }),
    ),
  );

  // --- Domain D: demo user + eligibility ----------------------------------
  const [user] = await db
    .insert(schema.userProfile)
    .values({
      email: "demo@yieldflow.app",
      legalFirst: "Dana",
      legalLast: "Demo",
      taxStatus: "us_person",
      w9OnFile: true,
      riskTolerance: "standard",
      maxOpenAccounts: 6,
      kycStatus: "verified",
    })
    .returning();

  await db.insert(schema.userAddress).values({
    userId: user.id,
    line1: "100 Peachtree St",
    city: "Atlanta",
    state: "GA",
    zip: "30303",
    isCurrent: true,
    effectiveFrom: d("2024-01-01"),
  });

  await db.insert(schema.consentRecord).values({
    userId: user.id,
    consentType: "tos_acceptance",
    version: "2026-07",
    grantedAt: d("2026-07-18"),
  });

  const MARGINAL_RATE_BPS = 3200; // 32% blended fed+state marginal rate

  // Checking bonus, fee waived: $1,500 capital, 90 days, $400 bonus.
  const checkingFeasibility = feasibilityScore({ ddDifficulty: "probabilistic" });
  const checkingEcon = computeEconomics({
    bonusCents: usd(400),
    interestCents: 0,
    feesCents: 0,
    capitalCents: usd(1500),
    holdDays: 90,
    marginalRateBps: MARGINAL_RATE_BPS,
    feasibility: checkingFeasibility,
  });

  await db.insert(schema.userOfferEligibility).values({
    userId: user.id,
    offerId: checkingOffer.id,
    eligibilityStatus: "eligible",
    computedAt: new Date(),
    expectedGrossBonusCents: usd(400),
    requiredCapitalCents: usd(1500),
    capitalDays: checkingEcon.capitalDays,
    projectedAnnualizedYieldBps: checkingEcon.projectedAnnualizedYieldBps,
    projectedNetAfterTaxBps: checkingEcon.projectedNetAfterTaxBps,
    feasibilityScore: checkingFeasibility,
    rankScore: checkingEcon.rankScore,
  });

  // MMA promo: $15k capital, 90 days, ~$155 interest, no fixed bonus.
  const mmaInterest = Math.round((usd(15_000) * 415 * 90) / (10_000 * 365));
  const mmaFeasibility = feasibilityScore({ ddDifficulty: "deterministic" });
  const mmaEcon = computeEconomics({
    bonusCents: 0,
    interestCents: mmaInterest,
    feesCents: 0,
    capitalCents: usd(15_000),
    holdDays: 90,
    marginalRateBps: MARGINAL_RATE_BPS,
    feasibility: mmaFeasibility,
  });

  await db.insert(schema.userOfferEligibility).values({
    userId: user.id,
    offerId: mmaOffer.id,
    eligibilityStatus: "eligible",
    computedAt: new Date(),
    expectedGrossBonusCents: 0,
    requiredCapitalCents: usd(15_000),
    capitalDays: mmaEcon.capitalDays,
    projectedAnnualizedYieldBps: mmaEcon.projectedAnnualizedYieldBps,
    projectedNetAfterTaxBps: mmaEcon.projectedNetAfterTaxBps,
    feasibilityScore: mmaFeasibility,
    rankScore: mmaEcon.rankScore,
  });

  // --- Domain E: linked accounts ------------------------------------------
  const [hub] = await db
    .insert(schema.linkedAccount)
    .values({
      userId: user.id,
      institutionId: regions.id,
      aggregator: "plaid",
      accountRole: "base_hub",
      accountMask: "4821",
      accountSubtype: "checking",
      status: "open",
      openedAt: d("2024-02-01"),
      achDailyLimitCents: usd(25_000),
      achMonthlyLimitCents: usd(100_000),
    })
    .returning();

  const [bonusAcct] = await db
    .insert(schema.linkedAccount)
    .values({
      userId: user.id,
      institutionId: regions.id,
      productId: checking.id,
      aggregator: "direct_api",
      accountRole: "bonus_target",
      accountMask: "7733",
      accountSubtype: "checking",
      status: "open",
      openedAt: d("2026-07-15"),
    })
    .returning();

  // A qualifying-looking payroll ACH credit toward the DD requirement.
  const [ddTxn] = await db
    .insert(schema.transaction)
    .values({
      linkedAccountId: bonusAcct.id,
      postedDate: d("2026-07-18"),
      amountCents: usd(1200),
      direction: "credit",
      descriptionRaw: "ACME CORP DIRECT DEP PPD",
      achSecCode: "PPD",
      achCompanyName: "ACME CORP",
      achCompanyEntryDescription: "DIRECT DEP",
      category: "payroll",
      isInternalTransfer: false,
      ddClassification: "likely_dd",
      ddConfidence: 0.78,
    })
    .returning();

  // --- Domain F: a live campaign for the checking bonus -------------------
  const [campaign] = await db
    .insert(schema.campaign)
    .values({
      userId: user.id,
      offerId: checkingOffer.id,
      linkedAccountId: bonusAcct.id,
      status: "in_progress",
      plannedStartDate: d("2026-07-15"),
      accountOpenedAt: d("2026-07-15"),
      requirementsDeadline: d("2026-10-13"), // account_open + 90d
      earliestSafeCloseDate: d("2027-01-11"), // account_open + 180d
      capitalCommittedCents: usd(1500),
      expectedBonusCents: usd(400),
    })
    .returning();

  // Progress rows for the two gating requirements of this offer.
  const offerRequirements = await db
    .select()
    .from(schema.requirement)
    .where(eq(schema.requirement.requirementGroupId, rootGroup.id));

  const ddReq = offerRequirements.find(
    (r) => r.requirementType === "direct_deposit_cumulative",
  )!;
  const balReq = offerRequirements.find(
    (r) => r.requirementType === "min_balance_avg_daily",
  )!;

  const [ddProgress] = await db
    .insert(schema.campaignRequirementProgress)
    .values({
      campaignId: campaign.id,
      requirementId: ddReq.id,
      targetAmountCents: usd(1000),
      accruedAmountCents: usd(1200),
      windowOpensAt: d("2026-07-15"),
      windowClosesAt: d("2026-10-13"),
      status: "satisfied",
      confidence: 0.78,
      lastEvaluatedAt: new Date(),
    })
    .returning();

  await db.insert(schema.campaignRequirementProgress).values({
    campaignId: campaign.id,
    requirementId: balReq.id,
    targetAmountCents: usd(1500),
    accruedAmountCents: usd(1500),
    windowOpensAt: d("2026-07-15"),
    windowClosesAt: d("2026-10-13"),
    status: "in_progress",
    confidence: 0.95,
    lastEvaluatedAt: new Date(),
  });

  // Link the payroll transaction as evidence for the DD requirement.
  await db.insert(schema.requirementEvidence).values({
    campaignRequirementProgressId: ddProgress.id,
    transactionId: ddTxn.id,
    contributionCents: usd(1200),
    matchRule: "payroll_ach:PPD+DIRECT DEP",
    matchConfidence: 0.78,
  });

  // A couple of open tasks for the agent's queue.
  await db.insert(schema.campaignTask).values([
    {
      campaignId: campaign.id,
      taskType: "confirm_bonus_posted",
      automationMode: "fully_auto",
      status: "pending",
      dueAt: d("2026-12-12"), // requirements + 60d payout window
    },
    {
      campaignId: campaign.id,
      taskType: "enroll_estatements",
      automationMode: "assisted_handoff",
      status: "done",
    },
  ]);

  // --- Domain I: an agent run that produced the eligibility recompute -----
  await db.insert(schema.agentRun).values({
    runType: "eligibility_recompute",
    triggeredBy: "schedule",
    modelName: "yieldflow-optimizer",
    modelVersion: "0.1.0",
    startedAt: new Date(),
    finishedAt: new Date(),
    status: "success",
    outputRef: { offersRanked: 2, topRankScore: checkingEcon.rankScore },
  });

  await db.insert(schema.notification).values({
    userId: user.id,
    campaignId: campaign.id,
    notificationType: "requirement_at_risk",
    severity: "info",
    sentAt: new Date(),
    channel: "email",
  });

  console.log("Seed complete.");
  console.log(
    `  Checking bonus: ${checkingEcon.projectedAnnualizedYieldBps / 100}% annualized ` +
      `(${checkingEcon.projectedNetAfterTaxBps / 100}% after tax), ` +
      `capital-days=${checkingEcon.capitalDays}`,
  );
  console.log(
    `  MMA promo:      ${mmaEcon.projectedAnnualizedYieldBps / 100}% annualized ` +
      `on $15k, interest≈$${(mmaInterest / 100).toFixed(2)}`,
  );
}

seed()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
