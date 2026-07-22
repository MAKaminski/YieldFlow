import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { centsToUsd } from "@/lib/yield";

// A precise, no-room-for-error instruction payload rendered by the cockpit and
// stored on campaign_task.result_json.
export interface TaskInstructions {
  title: string;
  detail: string;
  ctaLabel?: string;
  url?: string;
  channel?: "web" | "app" | "branch" | "phone";
  copyValues?: { label: string; value: string }[];
  warning?: string;
}

const CTA_BY_CHANNEL: Record<string, string> = {
  web: "Open application ↗",
  app: "Get the app ↗",
  branch: "Find a branch ↗",
  phone: "Call to open ↗",
};

const DD_SOURCE_TEXT: Record<string, string> = {
  payroll_ach: "employer payroll, pension, or government-benefit ACH only (no transfers/Zelle)",
  govt_benefit_ach: "government-benefit ACH",
  any_ach: "any recurring ACH deposit (payroll is safest)",
  external_transfer_ok: "an external transfer is accepted",
  no_internal_transfer: "an external source — internal transfers do not count",
};

const fmtDate = (d: Date) =>
  d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

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

  // --- Ordered task queue with precise per-step instructions ------------
  const applicationUrl = offer.applicationUrl ?? product?.accountOpeningUrl ?? offer.termsUrl ?? undefined;
  const channel = offer.applicationChannel ?? "web";
  const minOpen = product?.minOpeningDepositCents ?? 0;
  const payoutDate = addDays(requirementsDeadline, offer.payoutWindowDays ?? 60);

  // The gating deposit requirement drives the DD instructions.
  const ddReq = reqRows.find(
    (r) =>
      r.requirementType === "direct_deposit_cumulative" ||
      r.requirementType === "direct_deposit_per_period" ||
      r.requirementType === "new_money_deposit",
  );
  const ddAmount = ddReq?.targetAmountCents ?? 0;
  const ddWindowDays = ddReq?.windowDays ?? reqWindow;
  const ddDeadline = addDays(start, ddWindowDays);
  const ddSourceText =
    DD_SOURCE_TEXT[ddReq?.depositSourceConstraint ?? "any_ach"] ?? "a qualifying direct deposit";

  const openDetail =
    channel === "app"
      ? `${institution.brandName} is app-only — there is no web signup. Download the app and open the account inside it.`
      : channel === "branch"
        ? `Open ${product?.productName ?? "the account"} at a ${institution.brandName} branch.`
        : `Open ${product?.productName ?? "the account"} at ${institution.brandName} online${
            minOpen ? `. Minimum opening deposit ${centsToUsd(minOpen)}` : ""
          }.`;

  const taskSpecs: {
    taskType: (typeof schema.campaignTask.$inferInsert)["taskType"];
    automationMode: (typeof schema.campaignTask.$inferInsert)["automationMode"];
    dueAt?: Date;
    userActionUrl?: string;
    instructions: TaskInstructions;
  }[] = [
    {
      taskType: "open_account",
      automationMode: "assisted_handoff",
      userActionUrl: applicationUrl,
      instructions: {
        title: "Open the account",
        detail: openDetail,
        ctaLabel: CTA_BY_CHANNEL[channel],
        url: applicationUrl,
        channel,
        copyValues: offer.offerCode
          ? [{ label: "Promo code", value: offer.offerCode }]
          : [],
        warning: offer.signupNotes ?? undefined,
      },
    },
    {
      taskType: "enroll_estatements",
      automationMode: "assisted_handoff",
      instructions: {
        title: "Enroll in online banking + e-statements",
        detail:
          "In account settings, turn on online banking and paperless/e-statements — several banks require enrollment to qualify.",
      },
    },
    {
      taskType: "initiate_transfer",
      automationMode: "assisted_handoff",
      dueAt: addDays(start, 7),
      instructions: {
        title: "Fund the account",
        detail: `Move about ${centsToUsd(capitalCommittedCents)} in to cover the requirements and any minimum balance.`,
        warning:
          "Auto-funding needs a connected account (Feature 4 — backlogged). For now, push the funds yourself from your existing bank.",
      },
    },
    {
      taskType: "redirect_direct_deposit",
      automationMode: "assisted_handoff",
      dueAt: ddDeadline,
      instructions: {
        title: "Set up the qualifying direct deposit",
        detail:
          ddAmount > 0
            ? `Set up a qualifying direct deposit of at least ${centsToUsd(ddAmount)} to arrive within ${ddWindowDays} days (by ${fmtDate(ddDeadline)}). What counts here: ${ddSourceText}.`
            : `Meet the deposit requirement within ${ddWindowDays} days (by ${fmtDate(ddDeadline)}). What counts here: ${ddSourceText}.`,
        copyValues: ddAmount > 0 ? [{ label: "DD amount", value: centsToUsd(ddAmount) }] : [],
        warning: offer.signupNotes ?? undefined,
      },
    },
    {
      taskType: "confirm_bonus_posted",
      automationMode: "fully_auto",
      dueAt: payoutDate,
      instructions: {
        title: "Confirm the bonus posts",
        detail: `The ${centsToUsd(offer.bonusAmountCents ?? 0)} bonus should post by ${fmtDate(payoutDate)}. We watch for the credit — no action needed unless it's late.`,
      },
    },
    {
      taskType: "close_account",
      automationMode: "assisted_handoff",
      dueAt: earliestSafeCloseDate,
      instructions: {
        title: "Recall funds & close",
        detail: `On or after ${fmtDate(earliestSafeCloseDate)} (past the clawback window), recall your capital and close the account to stop fees.`,
        warning: "Closing before that date risks the bank clawing back the bonus.",
      },
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
        resultJson: { instructions: spec.instructions },
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
