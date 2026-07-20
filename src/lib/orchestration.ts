import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";

// Feature 5 — "click yes" campaign orchestration. startCampaign turns an offer
// into a live campaign: derived dates, per-requirement progress trackers, an
// ordered task queue (with bank deep-links + approval gates), and an
// approval-gated transfer plan for funding + end-of-period recall. It creates
// the plan; it does NOT move money (see lib/execution/adapter.ts).

const DAY_MS = 24 * 60 * 60 * 1000;
const addDays = (base: Date, days: number) => new Date(base.getTime() + days * DAY_MS);

export async function startCampaign(userId: string, offerId: string): Promise<string> {
  // Load offer + institution + product + requirements.
  const [head] = await db
    .select({ offer: schema.offer, institution: schema.institution, product: schema.product })
    .from(schema.offer)
    .innerJoin(schema.institution, eq(schema.offer.institutionId, schema.institution.id))
    .leftJoin(schema.product, eq(schema.offer.productId, schema.product.id))
    .where(eq(schema.offer.id, offerId))
    .limit(1);
  if (!head) throw new Error("Offer not found");
  const { offer, institution, product } = head;

  // Reuse the already-computed economics for expected bonus + capital.
  const [elig] = await db
    .select()
    .from(schema.userOfferEligibility)
    .where(
      and(
        eq(schema.userOfferEligibility.userId, userId),
        eq(schema.userOfferEligibility.offerId, offerId),
      ),
    )
    .limit(1);

  const requirements = await db
    .select({ requirement: schema.requirement })
    .from(schema.requirement)
    .innerJoin(
      schema.requirementGroup,
      eq(schema.requirement.requirementGroupId, schema.requirementGroup.id),
    )
    .where(eq(schema.requirementGroup.offerId, offerId));
  const reqRows = requirements.map((r) => r.requirement);

  // --- Derived dates ----------------------------------------------------
  const start = new Date();
  const reqWindow = offer.requirementWindowDays ?? 90;
  const clawback = institution.earlyClosureClawbackDays ?? 0;
  const requirementsDeadline = addDays(start, reqWindow);
  const earliestSafeCloseDate = addDays(start, Math.max(clawback, reqWindow));
  const plannedCloseDate = addDays(earliestSafeCloseDate, 7);

  const capitalCommittedCents = elig?.requiredCapitalCents ?? product?.minOpeningDepositCents ?? 0;
  const expectedBonusCents = offer.bonusAmountCents ?? 0;

  const [campaign] = await db
    .insert(schema.campaign)
    .values({
      userId,
      offerId,
      status: "planned",
      plannedStartDate: start,
      requirementsDeadline,
      earliestSafeCloseDate,
      plannedCloseDate,
      capitalCommittedCents,
      expectedBonusCents,
    })
    .returning({ id: schema.campaign.id });
  const campaignId = campaign.id;

  // --- Per-requirement progress ----------------------------------------
  if (reqRows.length) {
    await db.insert(schema.campaignRequirementProgress).values(
      reqRows.map((r) => ({
        campaignId,
        requirementId: r.id,
        targetAmountCents: r.targetAmountCents ?? undefined,
        targetCount: r.targetCount ?? undefined,
        windowOpensAt: start,
        windowClosesAt: addDays(start, r.windowDays ?? reqWindow),
        status: "not_started" as const,
      })),
    );
  }

  // --- Ordered task queue (deep-links + approval gates) -----------------
  // Insert sequentially so each task can block on the previous one.
  const taskSpecs: {
    taskType: (typeof schema.campaignTask.$inferInsert)["taskType"];
    automationMode: (typeof schema.campaignTask.$inferInsert)["automationMode"];
    dueAt?: Date;
    userActionUrl?: string;
  }[] = [
    {
      taskType: "open_account",
      automationMode: "assisted_handoff",
      userActionUrl: product?.accountOpeningUrl ?? offer.termsUrl ?? undefined,
    },
    { taskType: "enroll_estatements", automationMode: "assisted_handoff" },
    {
      taskType: "initiate_transfer",
      automationMode: "assisted_handoff",
      dueAt: addDays(start, 7),
    },
    {
      taskType: "redirect_direct_deposit",
      automationMode: "assisted_handoff",
      dueAt: addDays(start, 14),
    },
    {
      taskType: "confirm_bonus_posted",
      automationMode: "fully_auto",
      dueAt: addDays(requirementsDeadline, offer.payoutWindowDays ?? 60),
    },
    {
      taskType: "close_account",
      automationMode: "assisted_handoff",
      dueAt: earliestSafeCloseDate,
    },
  ];

  let prevId: string | null = null;
  for (const spec of taskSpecs) {
    const [task]: { id: string }[] = await db
      .insert(schema.campaignTask)
      .values({
        campaignId,
        taskType: spec.taskType,
        automationMode: spec.automationMode,
        status: prevId ? "blocked" : "pending",
        dueAt: spec.dueAt,
        blockedByTaskId: prevId ?? undefined,
        userActionUrl: spec.userActionUrl,
      })
      .returning({ id: schema.campaignTask.id });
    prevId = task.id;
  }

  // --- Approval-gated transfer plan (fund + recall) --------------------
  const [plan] = await db
    .insert(schema.transferPlan)
    .values({
      userId,
      planDate: start,
      objective: "maximize_bonus_yield",
      totalCapitalCents: capitalCommittedCents,
      solverVersion: "orchestration-0.1",
      status: "awaiting_approval",
      approvedByUserAt: null, // hard gate — nothing executes until approved
    })
    .returning({ id: schema.transferPlan.id });

  await db.insert(schema.transferLeg).values([
    {
      transferPlanId: plan.id,
      sequence: 0,
      amountCents: capitalCommittedCents,
      rail: "ach_standard",
      initiatingSide: "push_from_source",
      purpose: "fund_new_account",
      earliestInitiateDate: start,
      expectedSettleDate: addDays(start, 3),
      status: "planned",
      // fromAccountId/toAccountId null → needs a connected account (Feature 4).
    },
    {
      transferPlanId: plan.id,
      sequence: 1,
      amountCents: capitalCommittedCents,
      rail: "ach_standard",
      initiatingSide: "pull_from_destination",
      purpose: "wind_down", // recall funds at end of the deposit period
      earliestInitiateDate: earliestSafeCloseDate,
      expectedSettleDate: addDays(earliestSafeCloseDate, 3),
      status: "planned",
    },
  ]);

  return campaignId;
}
