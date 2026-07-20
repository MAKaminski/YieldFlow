"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db, schema } from "@/db";
import { startCampaign } from "@/lib/orchestration";

// Server actions — the app's write path. All mutations funnel through here so
// the UI stays declarative. Money never moves (see lib/execution/adapter.ts);
// these only advance campaign/task/plan state.

async function demoUserId(): Promise<string> {
  const [u] = await db
    .select({ id: schema.userProfile.id })
    .from(schema.userProfile)
    .where(eq(schema.userProfile.email, "demo@yieldflow.app"))
    .limit(1);
  if (!u) throw new Error("Demo user not found — run `npm run db:seed`.");
  return u.id;
}

/** Click an offer → create the campaign + task plan, then open its cockpit. */
export async function startCampaignAction(offerId: string): Promise<void> {
  const userId = await demoUserId();
  const campaignId = await startCampaign(userId, offerId);
  revalidatePath("/campaigns");
  redirect(`/campaigns/${campaignId}`);
}

/** Mark a task done and unblock the next task in the chain. */
export async function advanceTaskAction(taskId: string, campaignId: string): Promise<void> {
  await db
    .update(schema.campaignTask)
    .set({ status: "done" })
    .where(eq(schema.campaignTask.id, taskId));

  // Unblock any task that was waiting on this one.
  await db
    .update(schema.campaignTask)
    .set({ status: "pending" })
    .where(
      and(
        eq(schema.campaignTask.blockedByTaskId, taskId),
        eq(schema.campaignTask.status, "blocked"),
      ),
    );

  // Nudge the campaign forward on first action.
  await db
    .update(schema.campaign)
    .set({ status: "in_progress" })
    .where(and(eq(schema.campaign.id, campaignId), eq(schema.campaign.status, "planned")));

  revalidatePath(`/campaigns/${campaignId}`);
}

/** The hard approval gate — user authorizes the funding + recall plan. */
export async function approveTransferPlanAction(
  planId: string,
  campaignId: string,
): Promise<void> {
  await db
    .update(schema.transferPlan)
    .set({ status: "approved", approvedByUserAt: new Date() })
    .where(eq(schema.transferPlan.id, planId));
  await db
    .update(schema.transferLeg)
    .set({ status: "approved" })
    .where(eq(schema.transferLeg.transferPlanId, planId));
  revalidatePath(`/campaigns/${campaignId}`);
}

export async function abandonCampaignAction(campaignId: string): Promise<void> {
  await db
    .update(schema.campaign)
    .set({ status: "abandoned", failureReason: "user_abandoned" })
    .where(eq(schema.campaign.id, campaignId));
  revalidatePath(`/campaigns/${campaignId}`);
  redirect("/campaigns");
}
