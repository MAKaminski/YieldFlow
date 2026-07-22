import { NextResponse } from "next/server";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";

export const dynamic = "force-dynamic";

const CORS = { "access-control-allow-origin": "*", "access-control-allow-headers": "content-type" };

// Preflight for the agent's cross-origin POST.
export function OPTIONS() {
  return new NextResponse(null, { headers: CORS });
}

const progressSchema = z.object({
  campaignId: z.string(),
  taskType: z.string().optional(),
  status: z.enum([
    "started",
    "prefilled",
    // Granular per-action events the agent emits as it drives the page.
    "filled",
    "clicked",
    "navigated",
    "awaiting_user",
    "submitted",
    "done",
    "failed",
    "blocked",
  ]),
  note: z.string().max(500).optional(),
});

// POST — the local agent reports a progress event. Recorded as an agent_run;
// when a taskType is supplied we advance that campaign_task too.
export async function POST(req: Request) {
  const parsed = progressSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid" }, { status: 400, headers: CORS });
  }
  const { campaignId, taskType, status, note } = parsed.data;

  await db.insert(schema.agentRun).values({
    runType: "task_execute",
    triggeredBy: "user",
    modelName: "yieldflow-desktop-agent",
    status: status === "failed" ? "failed" : "success",
    startedAt: new Date(),
    finishedAt: new Date(),
    inputRef: { campaignId, taskType, status, note },
  });

  // Advance the matching campaign task when the agent finishes a step.
  if (taskType && (status === "submitted" || status === "done")) {
    await db
      .update(schema.campaignTask)
      .set({ status: "done" })
      .where(
        and(
          eq(schema.campaignTask.campaignId, campaignId),
          eq(schema.campaignTask.taskType, taskType as typeof schema.campaignTask.$inferInsert.taskType),
        ),
      );
  }

  return NextResponse.json({ ok: true }, { headers: CORS });
}

// GET ?campaignId= — the website polls this for live agent status.
export async function GET(req: Request) {
  const campaignId = new URL(req.url).searchParams.get("campaignId");
  if (!campaignId) {
    return NextResponse.json({ error: "campaignId required" }, { status: 400 });
  }
  const runs = await db
    .select({ inputRef: schema.agentRun.inputRef, at: schema.agentRun.finishedAt })
    .from(schema.agentRun)
    .where(eq(schema.agentRun.runType, "task_execute"))
    .orderBy(desc(schema.agentRun.createdAt))
    .limit(200);

  // Chronological (oldest → newest) so the activity log reads like a timeline.
  const events = runs
    .map((r) => ({ ...(r.inputRef as Record<string, unknown>), at: r.at }))
    .filter((e) => (e as { campaignId?: string }).campaignId === campaignId)
    .slice(0, 40)
    .reverse();

  return NextResponse.json({ campaignId, events });
}
