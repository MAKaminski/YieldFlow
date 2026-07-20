import { NextResponse } from "next/server";
import { buildAgentJob } from "@/lib/agent";

export const dynamic = "force-dynamic";

// GET /api/agent/job/[campaignId] — the local desktop agent fetches this to
// learn which offer to pursue and what to fill. Contains NO sensitive identity
// data; the agent merges autofill/identity values from its local vault.
export async function GET(
  req: Request,
  { params }: { params: Promise<{ campaignId: string }> },
) {
  const { campaignId } = await params;
  const origin = new URL(req.url).origin;
  const job = await buildAgentJob(campaignId, origin);
  if (!job) {
    return NextResponse.json({ error: "campaign not found" }, { status: 404 });
  }
  // CORS: the agent's local process fetches this directly.
  return NextResponse.json(job, {
    headers: { "access-control-allow-origin": "*" },
  });
}
